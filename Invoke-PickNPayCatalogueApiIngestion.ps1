param(
    [string]$StoreCode = "WC21",
    [int]$PageSize = 100,
    [int]$DelayMs = 150,
    [int]$MaxCategories = 0,
    [int]$MaxPagesPerCategory = 0,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"
$StateFile = Join-Path $CatalogueDir "pick-n-pay-api-state.json"
$Endpoint = "https://www.pnp.co.za/pnphybris/v2/pnp-spa/products/search"

$env:GPC_IMPORT_ONLY = "1"
. (Join-Path $Root "server.ps1")

function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -Force NoteProperty $Name $Value }
}

function Get-Number($Value) {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    try { return [math]::Round([double]$Value, 2) } catch { return $null }
}

function Get-ProductCodeFromUrl([string]$Url) {
    $match = [regex]::Match($Url, "/p/([^/?#]+)", "IgnoreCase")
    if (-not $match.Success) { return "" }
    return [Uri]::UnescapeDataString($match.Groups[1].Value).ToUpperInvariant()
}

function Get-ImageUrl($Product) {
    $images = @($Product.images)
    foreach ($format in @("product", "carousel", "listing", "thumbnail")) {
        $match = $images | Where-Object { $_.format -eq $format -and $_.url } | Select-Object -First 1
        if ($match) { return [string]$match.url }
    }
    return ""
}

function Get-CategoryHint($Product) {
    $categories = @($Product.categoryNames | Where-Object { $_ -and $_ -ne "All Products" })
    if ($categories.Count -gt 0) { return [string]$categories[0] }
    return "Other"
}

function Invoke-PnpSearch([string]$Query, [int]$Page, [int]$RequestedPageSize) {
    $fields = "products(code,name,brandSellerId,averageWeight,summary,price(FULL),images(DEFAULT),stock(FULL),available,quantityType,defaultQuantityOfUom,inStockIndicator,potentialPromotions(FULL),productDisplayBadges(DEFAULT),categoryNames),facets,pagination(DEFAULT),currentQuery"
    $parameters = @(
        "fields=$([Uri]::EscapeDataString($fields))"
        "query=$([Uri]::EscapeDataString($Query))"
        "pageSize=$RequestedPageSize"
        "currentPage=$Page"
        "storeCode=$StoreCode"
        "lang=en"
        "curr=ZAR"
    ) -join "&"
    $headers = @{
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
        "Accept" = "application/json, text/plain, */*"
        "Referer" = "https://www.pnp.co.za/"
        "X-Pnp-Cache-Key" = "anonymous"
        "X-Anonymous-Consents" = "%5B%5D"
        "X-Pnp-Search-Client-Id" = [guid]::NewGuid().ToString()
        "X-Pnp-Search-Session-Id" = "1"
    }
    $lastError = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$Endpoint`?$parameters" -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 60
            return $response.Content | ConvertFrom-Json
        } catch {
            $lastError = $_
            if ($attempt -lt 4) { Start-Sleep -Seconds ([math]::Pow(2, $attempt)) }
        }
    }
    throw $lastError
}

function Save-SourceRows($Rows) {
    $temporary = "$SourceProductsFile.tmp"
    $json = ConvertTo-Json -InputObject ([object[]]$Rows) -Depth 30
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $SourceProductsFile -Force
}

function Save-State($State) {
    $State.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$rows = [System.Collections.Generic.List[object]]::new()
if (Test-Path -LiteralPath $SourceProductsFile) {
    foreach ($row in [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)) { $rows.Add($row) }
}

$rowsByCode = @{}
foreach ($row in $rows) {
    if ($row.storeId -ne "pick-n-pay") { continue }
    $code = if ($row.retailerProductId) { ([string]$row.retailerProductId).ToUpperInvariant() } else { Get-ProductCodeFromUrl $row.url }
    if (-not $code) { continue }
    if (-not $rowsByCode.ContainsKey($code)) { $rowsByCode[$code] = [System.Collections.Generic.List[object]]::new() }
    $rowsByCode[$code].Add($row)
}

$state = if (-not $Restart -and (Test-Path -LiteralPath $StateFile)) {
    Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
} else {
    [pscustomobject]@{
        status = "starting"
        storeCode = $StoreCode
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        completedCategoryQueries = @()
        productsSeen = 0
        productsUpdated = 0
        message = "Reading Pick n Pay categories"
    }
}
$state.status = "running"
$state.storeCode = $StoreCode
if ([int]$state.productsSeen -eq 0 -and @($state.completedCategoryQueries).Count -gt 0) {
    $state.completedCategoryQueries = @()
    $state.message = "Resetting empty category checkpoints"
}
Save-State $state

$root = Invoke-PnpSearch ":relevance" 0 1
$categoryFacet = $root.facets | Where-Object { $_.category -eq $true } | Select-Object -First 1
if (-not $categoryFacet) { throw "Pick n Pay did not return its category facet." }
$categories = @($categoryFacet.values | Sort-Object count -Descending)
if ($MaxCategories -gt 0) { $categories = @($categories | Select-Object -First $MaxCategories) }

$completed = @{}
foreach ($query in @($state.completedCategoryQueries)) { $completed[[string]$query] = $true }
$seenCodes = @{}
$updatedCount = [int]$state.productsUpdated
$seenCount = [int]$state.productsSeen

foreach ($category in $categories) {
    $query = ([string]$category.query.query.value) -replace ":category:", ":allCategories:"
    if ($completed.ContainsKey($query)) {
        Write-Host "Skipping completed category: $($category.name)"
        continue
    }

    Write-Host "Importing $($category.name) ($($category.count) products)"
    $page = 0
    $totalPages = 1
    do {
        $payload = Invoke-PnpSearch $query $page $PageSize
        $totalPages = [int]$payload.pagination.totalPages
        if ($MaxPagesPerCategory -gt 0) { $totalPages = [math]::Min($totalPages, $MaxPagesPerCategory) }
        Write-Host "  page $($page + 1)/$totalPages - $(@($payload.products).Count) products"

        foreach ($product in @($payload.products)) {
            $code = ([string]$product.code).ToUpperInvariant()
            if (-not $code) { continue }
            if (-not $seenCodes.ContainsKey($code)) { $seenCodes[$code] = $true; $seenCount += 1 }

            $price = Get-Number $product.price.value
            $regularPrice = Get-Number $product.price.oldPrice
            if ($regularPrice -and $price -and $regularPrice -le $price) { $regularPrice = $null }
            $promoApplied = [bool]($regularPrice -and $price)
            $promoText = ""
            if ($promoApplied) {
                $saving = [math]::Round($regularPrice - $price, 2)
                $promoText = "SAVE R$($saving.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture))"
            }
            if ($product.potentialPromotions) {
                $promotion = @($product.potentialPromotions) | Select-Object -First 1
                foreach ($property in @("description", "title", "promotionTextMessage")) {
                    if ($promotion.$property) { $promoText = Clean-Text $promotion.$property; break }
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($promoText)) { $promoApplied = $true }
            $promoType = if ($regularPrice) { "sale" } elseif ($promoApplied) { "promotion" } else { "" }

            $targets = if ($rowsByCode.ContainsKey($code)) { @($rowsByCode[$code]) } else { @() }
            if ($targets.Count -eq 0) {
                $newRow = [pscustomobject]@{
                    id = "pick-n-pay-$code"
                    retailerProductId = $code
                    storeId = "pick-n-pay"
                    storeName = "Pick n Pay"
                    source = "retailer-api"
                    searchTerm = ""
                    categoryHint = Get-CategoryHint $product
                    productName = Clean-Text $product.name
                    brand = Clean-Text $product.brandSellerId
                    size = ""
                    unit = ""
                    price = $price
                    regularPrice = $regularPrice
                    promoText = $promoText
                    promoType = $promoType
                    promoApplied = $promoApplied
                    imageUrl = Get-ImageUrl $product
                    url = "https://www.pnp.co.za/p/$code"
                    status = $(if ($price) { "priced" } else { "price-missing" })
                    reviewStatus = "unreviewed"
                    published = $false
                    score = 1
                    discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
                    lastSeenAt = (Get-Date).ToUniversalTime().ToString("o")
                    searchUrl = ""
                }
                $rows.Add($newRow)
                $rowsByCode[$code] = [System.Collections.Generic.List[object]]::new()
                $rowsByCode[$code].Add($newRow)
                $targets = @($newRow)
            }

            foreach ($row in $targets) {
                Set-Prop $row "retailerProductId" $code
                Set-Prop $row "source" "retailer-api"
                Set-Prop $row "productName" (Clean-Text $product.name)
                Set-Prop $row "brand" (Clean-Text $product.brandSellerId)
                Set-Prop $row "categoryHint" (Get-CategoryHint $product)
                Set-Prop $row "price" $price
                Set-Prop $row "regularPrice" $regularPrice
                Set-Prop $row "promoText" $promoText
                Set-Prop $row "promoType" $promoType
                Set-Prop $row "promoApplied" $promoApplied
                Set-Prop $row "imageUrl" (Get-ImageUrl $product)
                Set-Prop $row "available" [bool]$product.available
                Set-Prop $row "stockStatus" [string]$product.stock.stockLevelStatus
                Set-Prop $row "priceStoreCode" $StoreCode
                Set-Prop $row "status" $(if ($price) { "priced" } else { "price-missing" })
                Set-Prop $row "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
                Set-Prop $row "published" $false
                $measure = Get-ProductMeasure $product.name $row.url $product.name
                if ($measure) {
                    Set-Prop $row "size" $measure.label
                    Set-Prop $row "unit" $measure.unit
                }
            }
            $updatedCount += 1
        }

        $page += 1
        if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    } while ($page -lt $totalPages)

    Save-SourceRows $rows.ToArray()
    $completed[$query] = $true
    $state.completedCategoryQueries = @($completed.Keys | Sort-Object)
    $state.productsSeen = $seenCount
    $state.productsUpdated = $updatedCount
    $state.message = "Completed $($category.name)"
    Save-State $state
}

Save-SourceRows $rows.ToArray()
@($rows | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8
$state.status = "complete"
$state.message = "Pick n Pay catalogue API import complete"
$state.productsSeen = $seenCount
$state.productsUpdated = $updatedCount
Set-Prop $state "completedAt" ((Get-Date).ToUniversalTime().ToString("o"))
Save-State $state

Write-Host "Pick n Pay import complete: $seenCount unique API products seen; $updatedCount product updates processed."
