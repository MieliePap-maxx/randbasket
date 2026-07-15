param(
    [double]$Latitude = -26.1076,
    [double]$Longitude = 28.0567,
    [int]$PageSize = 200,
    [int]$MaxRowsPerTerm = 2000,
    [int]$MaxTerms = 0,
    [int]$CheckpointEvery = 20,
    [int]$DelayMs = 100,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"
$StateFile = Join-Path $CatalogueDir "checkers-api-state.json"
$TokenUrl = "https://ciamdslprod.auth.eu-west-1.amazoncognito.com/oauth2/token"
$ApiBase = "https://catalog.sixty60.co.za"
$ClientId = "46bt6e08m017dkqtf5hc53vkf4"
$ClientSecret = "1bikmtteg9flve1agqqrhkhbv27lt51lbg956vs7t7o54sgsf3ph"
$ApiKey = "5y2GIJ8RoP8dm5FxUtsBZ66OfvAZ8Njh3Pjaj9WF"

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

function Get-ArticleNumber([string]$Url) {
    $match = [regex]::Match($Url, "(?:-|/)([0-9]{8})(?:EA|KG|KGM)?(?:[/?#]|$)", "IgnoreCase")
    if ($match.Success) { return $match.Groups[1].Value }
    return ""
}

function Get-Slug([string]$Value) {
    $slug = (Clean-Text $Value).ToLowerInvariant()
    $slug = $slug -replace "&", "-and-"
    $slug = $slug -replace "[^a-z0-9]+", "-"
    return $slug.Trim("-")
}

function Save-SourceRows($Rows) {
    $temporary = "$SourceProductsFile.tmp"
    $json = ConvertTo-Json -InputObject ([object[]]$Rows) -Depth 30
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $SourceProductsFile -Force
}

function Save-State($State) {
    $State.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $State | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Get-AccessToken {
    $body = "grant_type=client_credentials&client_id=$([Uri]::EscapeDataString($ClientId))&client_secret=$([Uri]::EscapeDataString($ClientSecret))"
    $lastError = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $TokenUrl -ContentType "application/x-www-form-urlencoded" -Body $body -TimeoutSec 40
            return [string](($response.Content | ConvertFrom-Json).access_token)
        } catch {
            $lastError = $_
            if ($attempt -lt 4) { Start-Sleep -Seconds ([math]::Pow(2, $attempt)) }
        }
    }
    throw $lastError
}

function Invoke-ApiRequest([string]$Method, [string]$Url, $Body = $null) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        $request = $null
        $response = $null
        try {
            $httpMethod = if ($Method -eq "Post") { [System.Net.Http.HttpMethod]::Post } else { [System.Net.Http.HttpMethod]::Get }
            $request = [System.Net.Http.HttpRequestMessage]::new($httpMethod, $Url)
            if ($null -ne $Body) {
                $json = ConvertTo-Json -InputObject $Body -Depth 15
                $request.Content = [System.Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, "application/json")
            }
            $response = $script:HttpClient.SendAsync($request).GetAwaiter().GetResult()
            $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) {
                throw "HTTP $([int]$response.StatusCode): $content"
            }
            return $content | ConvertFrom-Json
        } catch {
            $lastError = $_
            if ($response -and [int]$response.StatusCode -in @(401, 403)) {
                $script:HttpClient.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", (Get-AccessToken))
            }
            if ($attempt -lt 4) { Start-Sleep -Seconds ([math]::Pow(2, $attempt)) }
        } finally {
            if ($response) { $response.Dispose() }
            if ($request) { $request.Dispose() }
        }
    }
    throw $lastError
}

function Get-SearchTerms($CheckersRows) {
    $stopWords = @{}
    foreach ($word in @("with","and","the","for","from","pack","flavour","flavoured","assorted","fresh","large","small","medium","white","black","red","blue","green","checkers","housebrand","each","per","gram","grams")) { $stopWords[$word] = $true }

    $tokensByRow = @{}
    $rowsByToken = @{}
    foreach ($row in $CheckersRows) {
        $rowKey = if ($row.id) { [string]$row.id } elseif ($row.url) { [string]$row.url } else { "" }
        if (-not $rowKey) { continue }
        $tokens = @([regex]::Matches(([string]$row.productName).ToLowerInvariant(), "[a-z][a-z0-9]{3,}") |
            ForEach-Object { $_.Value } |
            Where-Object { -not $stopWords.ContainsKey($_) } |
            Select-Object -Unique)
        if ($tokens.Count -eq 0) {
            $tokens = @([regex]::Matches(([string]$row.productName).ToLowerInvariant(), "[a-z][a-z0-9]{2,}") | ForEach-Object { $_.Value } | Select-Object -Unique)
        }
        $tokensByRow[$rowKey] = $tokens
        foreach ($token in $tokens) {
            if (-not $rowsByToken.ContainsKey($token)) { $rowsByToken[$token] = [System.Collections.Generic.List[string]]::new() }
            $rowsByToken[$token].Add($rowKey)
        }
    }

    $covered = @{}
    $terms = [System.Collections.Generic.List[string]]::new()
    $ranked = @($rowsByToken.Keys | Sort-Object @{ Expression = { $rowsByToken[$_].Count }; Descending = $true }, @{ Expression = { $_.Length }; Descending = $true })
    foreach ($token in $ranked) {
        $members = @($rowsByToken[$token])
        if ($members.Count -gt $MaxRowsPerTerm) { continue }
        $uncovered = @($members | Where-Object { $_ -and -not $covered.ContainsKey([string]$_) })
        if ($uncovered.Count -eq 0) { continue }
        $terms.Add($token)
        foreach ($rowId in $members) { if ($rowId) { $covered[[string]$rowId] = $true } }
    }

    foreach ($row in $CheckersRows) {
        $rowId = if ($row.id) { [string]$row.id } elseif ($row.url) { [string]$row.url } else { "" }
        if (-not $rowId) { continue }
        if ($covered.ContainsKey($rowId)) { continue }
        $tokens = @($tokensByRow[$rowId] | Sort-Object @{ Expression = { if ($rowsByToken.ContainsKey($_)) { $rowsByToken[$_].Count } else { 999999 } } }, @{ Expression = { $_.Length }; Descending = $true })
        if ($tokens.Count -gt 0) {
            $terms.Add([string]$tokens[0])
            foreach ($member in @($rowsByToken[[string]$tokens[0]])) { if ($member) { $covered[[string]$member] = $true } }
        } elseif ($row.productName) {
            $terms.Add((Clean-Text $row.productName))
            $covered[$rowId] = $true
        }
    }
    return @($terms | Select-Object -Unique)
}

function New-FilterBody([string]$Term, [int]$Page) {
    return @{
        filter = @{
            showAllDisplayVariants = $false
            showNotRangedProducts = $false
            productListSource = @{ search = $Term }
            paginationOptions = @{ page = $Page; pageSize = $PageSize }
            filterOptions = @{
                filterIds = $null
                dealsOnly = $false
                brandOptions = @()
                departmentOptions = @()
                serviceOptions = @(@{ serviceOptionId = $script:ServiceOptionId })
                facetOptions = @()
            }
            sortOptions = $null
        }
        displayOptions = @{ includeDisplayCategoryTree = $false }
        userContext = @{
            storeContexts = @($script:StoreContext)
            userId = $script:UserId
        }
    }
}

function Update-ProductRows($Product, $BonusBuys) {
    $article = [string]$Product.articleNumber
    if (-not $article) { return 0 }
    $factor = Get-Number $Product.priceFactor
    if (-not $factor -or $factor -le 0) { $factor = 100 }
    $price = Get-Number ([double]$Product.priceWithoutDecimal / $factor)
    $regularPrice = Get-Number ([double]$Product.oldPrice / $factor)
    if (-not $regularPrice -or -not $price -or $regularPrice -le $price) { $regularPrice = $null }
    $promoApplied = [bool]($Product.isOnPromotion -or $regularPrice -or @($Product.bonusBuyIds).Count -gt 0)
    $promoText = ""
    if ($regularPrice -and $price) {
        $saving = [math]::Round($regularPrice - $price, 2)
        $promoText = "SAVE R$($saving.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture))"
    }
    if (@($Product.bonusBuyIds).Count -gt 0 -and $BonusBuys) {
        foreach ($bonusId in @($Product.bonusBuyIds)) {
            $bonus = $BonusBuys.PSObject.Properties[[string]$bonusId].Value
            if ($bonus) {
                foreach ($property in @("displayName", "description", "name")) {
                    if ($bonus.$property) { $promoText = Clean-Text $bonus.$property; break }
                }
                if ($promoText) { break }
            }
        }
    }

    $targets = if ($script:RowsByArticle.ContainsKey($article)) { @($script:RowsByArticle[$article]) } else { @() }
    if ($targets.Count -eq 0) {
        $unit = ([string]$Product.unitOfMeasure).ToUpperInvariant()
        $name = Clean-Text $(if ($Product.displayName) { $Product.displayName } else { $Product.name })
        $newRow = [pscustomobject]@{
            id = "checkers-$article$unit"
            retailerProductId = "$article$unit"
            storeId = "checkers"
            storeName = "Checkers"
            source = "retailer-api"
            searchTerm = ""
            categoryHint = "Other"
            productName = $name
            brand = ""
            size = ""
            unit = ""
            price = $price
            regularPrice = $regularPrice
            promoText = $promoText
            promoType = $(if ($promoApplied) { "sale" } else { "" })
            promoApplied = $promoApplied
            imageUrl = $(if ($Product.imageId) { "$ApiBase/v2/files/$($Product.imageId)?width=400&height=400" } else { "" })
            url = "https://www.checkers.co.za/product/$(Get-Slug $name)-$article$unit"
            status = $(if ($price) { "priced" } else { "price-missing" })
            reviewStatus = "unreviewed"
            published = $false
            score = 1
            discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
            lastSeenAt = (Get-Date).ToUniversalTime().ToString("o")
            searchUrl = ""
        }
        $script:Rows.Add($newRow)
        $script:RowsByArticle[$article] = [System.Collections.Generic.List[object]]::new()
        $script:RowsByArticle[$article].Add($newRow)
        $targets = @($newRow)
    }

    foreach ($row in $targets) {
        $name = Clean-Text $(if ($Product.displayName) { $Product.displayName } else { $Product.name })
        Set-Prop $row "retailerProductId" "$article$([string]$Product.unitOfMeasure)"
        Set-Prop $row "source" "retailer-api"
        Set-Prop $row "productName" $name
        Set-Prop $row "price" $price
        Set-Prop $row "regularPrice" $regularPrice
        Set-Prop $row "promoText" $promoText
        Set-Prop $row "promoType" $(if ($promoApplied) { "sale" } else { "" })
        Set-Prop $row "promoApplied" $promoApplied
        Set-Prop $row "imageUrl" $(if ($Product.imageId) { "$ApiBase/v2/files/$($Product.imageId)?width=400&height=400" } else { "" })
        Set-Prop $row "available" [bool]$Product.isStockAvailable
        Set-Prop $row "stockOnHand" $Product.stockOnHand
        Set-Prop $row "priceStoreId" $script:StoreContext.storeId
        Set-Prop $row "priceRegion" "Johannesburg-Sandton"
        Set-Prop $row "status" $(if ($price) { "priced" } else { "price-missing" })
        Set-Prop $row "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
        Set-Prop $row "published" $false
        $measure = Get-ProductMeasure $name $row.url $name
        if ($measure) {
            Set-Prop $row "size" $measure.label
            Set-Prop $row "unit" $measure.unit
        }
    }
    return 1
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$script:Rows = [System.Collections.Generic.List[object]]::new()
foreach ($row in [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)) { $script:Rows.Add($row) }
$checkersRows = @($script:Rows | Where-Object { $_.storeId -eq "checkers" })
$script:RowsByArticle = @{}
foreach ($row in $checkersRows) {
    $article = if ($row.articleNumber) { [string]$row.articleNumber } else { Get-ArticleNumber $row.url }
    if (-not $article) { continue }
    if (-not $script:RowsByArticle.ContainsKey($article)) { $script:RowsByArticle[$article] = [System.Collections.Generic.List[object]]::new() }
    $script:RowsByArticle[$article].Add($row)
}

$state = if (-not $Restart -and (Test-Path -LiteralPath $StateFile)) {
    Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
} else {
    [pscustomobject]@{
        status = "starting"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        completedTerms = @()
        termsTotal = 0
        productsUpdated = 0
        message = "Preparing Checkers catalogue import"
    }
}

$script:UserId = if ($state.userId) { [string]$state.userId } else { [guid]::NewGuid().ToString("N").Substring(0, 24) }
Set-Prop $state "userId" $script:UserId
$script:HttpClient = [System.Net.Http.HttpClient]::new()
$script:HttpClient.Timeout = [TimeSpan]::FromSeconds(75)
$script:HttpClient.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", (Get-AccessToken))
$script:HttpClient.DefaultRequestHeaders.TryAddWithoutValidation("x-api-key", $ApiKey) | Out-Null
$script:HttpClient.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json") | Out-Null
$script:HttpClient.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36") | Out-Null
$script:HttpClient.DefaultRequestHeaders.TryAddWithoutValidation("UserId", $script:UserId) | Out-Null
$contextPayload = @{ latitude = $Latitude; longitude = $Longitude; brandListId = "checkers" }
$contexts = Invoke-ApiRequest "Post" "$ApiBase/api/v3/store-contexts" $contextPayload
$script:StoreContext = @($contexts.items |
    Where-Object { @($_.serviceOptionIds) -contains "sixty-min-delivery" } |
    Sort-Object distanceFromCustomer, brandPriority |
    Select-Object -First 1)[0]
if (-not $script:StoreContext) { throw "Checkers returned no Sixty60 store for the configured coordinates." }
$script:ServiceOptionId = "sixty-min-delivery"
Set-Prop $state "storeId" ([string]$script:StoreContext.storeId)
Set-Prop $state "priceRegion" "Johannesburg-Sandton"

$terms = @(Get-SearchTerms $checkersRows)
if ($MaxTerms -gt 0) { $terms = @($terms | Select-Object -First $MaxTerms) }
$state.termsTotal = $terms.Count
$state.status = "running"
$state.message = "Importing Checkers prices from $($terms.Count) targeted catalogue searches"
Save-State $state

$completed = @{}
foreach ($term in @($state.completedTerms)) { $completed[[string]$term] = $true }
$updated = [int]$state.productsUpdated
$sinceCheckpoint = 0
$termIndex = 0

foreach ($term in $terms) {
    $termIndex += 1
    if ($completed.ContainsKey($term)) { continue }
    $page = 0
    $totalPages = 1
    do {
        $url = "$ApiBase/api/v3/products/filter?includePromotions=true&promotionChannel=sixty60"
        $payload = Invoke-ApiRequest "Post" $url (New-FilterBody $term $page)
        $total = [int]$payload.totalCount
        $totalPages = [math]::Max(1, [math]::Ceiling($total / [double]$PageSize))
        foreach ($product in @($payload.products)) { $updated += Update-ProductRows $product $payload.bonusBuys }
        $page += 1
        if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    } while ($page -lt $totalPages)

    $completed[$term] = $true
    $sinceCheckpoint += 1
    Write-Host "[$termIndex/$($terms.Count)] $term - $total matches, $updated product records updated"
    if ($sinceCheckpoint -ge $CheckpointEvery) {
        Save-SourceRows $script:Rows.ToArray()
        $state.completedTerms = @($completed.Keys | Sort-Object)
        $state.productsUpdated = $updated
        $state.message = "Imported $($completed.Count) of $($terms.Count) Checkers search groups"
        Save-State $state
        $sinceCheckpoint = 0
    }
}

Save-SourceRows $script:Rows.ToArray()
@($script:Rows | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8
$state.completedTerms = @($completed.Keys | Sort-Object)
$state.productsUpdated = $updated
$state.status = "complete"
$state.message = "Checkers regional catalogue API import complete"
Set-Prop $state "completedAt" ((Get-Date).ToUniversalTime().ToString("o"))
Save-State $state
Write-Host "Checkers import complete: $updated live product records updated for store $($script:StoreContext.storeId)."
if ($script:HttpClient) { $script:HttpClient.Dispose() }
