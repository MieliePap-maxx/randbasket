param(
    [string[]]$StoreId = @("pick-n-pay", "woolworths", "checkers"),
    [int]$SkipProductsPerStore = 0,
    [int]$MaxProductsPerStore = 100,
    [switch]$FetchPrices,
    [switch]$Append
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourcesFile = Join-Path $CatalogueDir "retailer-sources.json"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $SourcesFile)) { throw "Retailer source config not found: $SourcesFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Read-JsonArray($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return [object[]](Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Get-SitemapText([string]$Url) {
    $headers = @{
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        "Accept" = "application/xml,text/xml,text/plain,*/*"
    }
    $response = Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 35
    if ($Url -notmatch "\.gz(?:\?|$)") { return [string]$response.Content }
    try {
        $content = [byte[]]$response.Content
        $input = [System.IO.MemoryStream]::new($content)
        $gzip = [System.IO.Compression.GzipStream]::new($input, [System.IO.Compression.CompressionMode]::Decompress)
        $reader = [System.IO.StreamReader]::new($gzip)
        try { return $reader.ReadToEnd() }
        finally {
            $reader.Dispose()
            $gzip.Dispose()
            $input.Dispose()
        }
    } catch {
        throw "Could not decompress sitemap $Url - $($_.Exception.Message)"
    }
}

function Get-SitemapUrls([string]$Url, [int]$Depth = 0, [int]$MaxUrls = 50000) {
    if ([string]::IsNullOrWhiteSpace($Url) -or $Depth -gt 2) { return @() }
    try {
        [xml]$xml = Get-SitemapText $Url
    } catch {
        Write-Host "    sitemap read failed: $Url - $($_.Exception.Message)"
        return @()
    }
    $urls = [System.Collections.Generic.List[string]]::new()
    foreach ($loc in @($xml.SelectNodes("//*[local-name()='loc']"))) {
        $value = [string]$loc.InnerText
        if ($value -match "\.xml(?:\.gz)?$" -and $Depth -lt 2) {
            foreach ($childUrl in @(Get-SitemapUrls $value ($Depth + 1) $MaxUrls)) {
                $urls.Add([string]$childUrl)
                if ($urls.Count -ge $MaxUrls) { break }
            }
        } else {
            $urls.Add($value)
        }
        if ($urls.Count -ge $MaxUrls) { break }
    }
    return $urls.ToArray()
}

function Get-ProductNameFromUrl([string]$Url) {
    try { $path = ([Uri]$Url).AbsolutePath } catch { $path = $Url }
    $parts = @($path.Trim("/").Split("/") | Where-Object { $_ })
    $slug = ""
    if ($Url -match "pnp\.co\.za") {
        $slug = @($parts | Where-Object { $_ -ne "p" } | Select-Object -First 1)
    } elseif ($Url -match "checkers\.co\.za/product/") {
        $slug = $parts[-1] -replace "-[0-9]+(?:EA|KG)?$", ""
    } elseif ($Url -match "woolworths\.co\.za/prod/") {
        $slug = @($parts | Where-Object { $_ -ne "_" -and $_ -notmatch "^A-[0-9]+" } | Select-Object -Last 1)
    } elseif ($Url -match "makro\.co\.za/.+/p/") {
        $slug = $parts | Select-Object -First 1
    }
    if (-not $slug) { $slug = $parts[-1] }
    $name = [Uri]::UnescapeDataString([string]$slug)
    $name = $name -replace "[-_]+", " "
    return (Get-Culture).TextInfo.ToTitleCase((Clean-Text $name).ToLowerInvariant())
}

function Get-CategoryHintFromUrl([string]$Url, [string]$Name = "") {
    $lower = "$Url $Name".ToLowerInvariant()
    if ($lower -match "tooth|toothpaste|mouth|oral|beauty|personal-care|toiletries|health") { return "Personal Care" }
    if ($lower -match "custard|dessert|pudding|ice-cream|sweets|chocolate|jelly") { return "Desserts" }
    if ($lower -match "milk|dairy|eggs|cheese|yoghurt|yogurt|cream|butter") { return "Dairy" }
    if ($lower -match "bread|bakery|rolls|bun|wrap|roti|croissant") { return "Bakery" }
    if ($lower -match "meat|chicken|beef|mince|pork|fish|lamb|mutton|wors|boerewors|sausage|steak|wing|drumstick|bacon|biltong") { return "Meat" }
    if ($lower -match "fruit|vegetable|potato|tomato|onion|salad|apple|banana|avocado|carrot|spinach|lettuce") { return "Fruit & Vegetables" }
    if ($lower -match "clean|dishwash|laundry|household|detergent|bleach|soap|softener|toilet-paper|paper-towel") { return "Cleaning & Household" }
    if ($lower -match "baby|nappies|diaper|formula|purity") { return "Baby" }
    if ($lower -match "pet|dog|cat|kitten|puppy") { return "Pets" }
    if ($lower -match "pantry|rice|pasta|flour|sugar|oil|sauce|spice|salt|cereal|oats|maize|beans|lentils|canned|tin") { return "Pantry" }
    if ($lower -match "beverage|juice|coffee|tea|water|cooldrink|drink|cola|coke|sprite|fanta") { return "Beverages" }
    return "Uncategorised"
}

function Get-ExactProductData($Retailer, [string]$Url, [string]$FallbackName) {
    if (-not $FetchPrices) { return $null }
    try {
        $page = Fetch-Page $Url
        $products = @(Extract-ExactProductPage $Retailer.storeId $page $FallbackName $Url)
        if ($products.Count -eq 0 -and $Retailer.storeId -in @("pick-n-pay","checkers")) {
            $rendered = Invoke-RenderedPage $Url 24000
            if ($rendered) { $products = @(Extract-ExactProductPage $Retailer.storeId $rendered $FallbackName $Url) }
        }
        return $products | Select-Object -First 1
    } catch {
        return $null
    }
}

function New-SourceRow($Retailer, [string]$Url) {
    $name = Get-ProductNameFromUrl $Url
    $product = Get-ExactProductData $Retailer $Url $name
    if ($product -and $product.name) { $name = $product.name }
    $measure = Get-ProductMeasure $name $Url $name
    return [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        storeId = $Retailer.storeId
        storeName = $Retailer.storeName
        source = "sitemap"
        searchTerm = ""
        categoryHint = Get-CategoryHintFromUrl $Url $name
        productName = $name
        brand = ""
        size = $(if ($measure) { $measure.label } else { "" })
        unit = $(if ($measure) { $measure.unit } else { "" })
        price = $(if ($product) { $product.price } else { $null })
        regularPrice = $(if ($product) { $product.regularPrice } else { $null })
        promoText = $(if ($product) { $product.promoText } else { "" })
        promoType = $(if ($product) { $product.promoType } else { "" })
        promoApplied = $(if ($product) { $product.promoApplied } else { $false })
        url = $Url
        status = $(if ($product -and $product.price) { "priced" } else { "url-only" })
        reviewStatus = "unreviewed"
        published = $false
        score = 1
        discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
        lastSeenAt = $(if ($product -and $product.price) { (Get-Date).ToUniversalTime().ToString("o") } else { "" })
        searchUrl = ""
    }
}

function Merge-SourceProducts($Existing, $Incoming) {
    $byKey = @{}
    $merged = [System.Collections.Generic.List[object]]::new()
    foreach ($row in @($Existing)) {
        $urlKey = Clean-Text $row.url
        if ($urlKey) { $key = "$(Clean-Text $row.storeId)|$urlKey" }
        else { $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.productName)" }
        if ($byKey.ContainsKey($key)) { continue }
        $byKey[$key] = $row
        $merged.Add($row)
    }
    foreach ($row in @($Incoming)) {
        $urlKey = Clean-Text $row.url
        if ($urlKey) { $key = "$(Clean-Text $row.storeId)|$urlKey" }
        else { $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.productName)" }
        if ($byKey.ContainsKey($key)) {
            $existing = $byKey[$key]
            foreach ($prop in "productName","categoryHint","price","regularPrice","promoText","promoType","promoApplied","status","lastSeenAt") {
                if ($row.$prop -ne $null -and [string]$row.$prop -ne "") {
                    if ($existing.PSObject.Properties.Name -contains $prop) { $existing.$prop = $row.$prop }
                    else { $existing | Add-Member -Force NoteProperty $prop $row.$prop }
                }
            }
        } else {
            $byKey[$key] = $row
            $merged.Add($row)
        }
    }
    return [object[]]$merged.ToArray()
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$sourceConfig = Get-Content -Raw -LiteralPath $SourcesFile | ConvertFrom-Json
$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$incoming = [System.Collections.Generic.List[object]]::new()

foreach ($retailer in @($sourceConfig.retailers)) {
    if (-not $retailer.enabled) { continue }
    if ($storeFilter.Count -gt 0 -and $storeFilter -notcontains ([string]$retailer.storeId).ToLowerInvariant()) { continue }
    if (-not $retailer.sitemapIndexUrl) { continue }
    Write-Host "Reading product sitemap: $($retailer.storeName)"
    $sitemapLimit = [math]::Max(1, $SkipProductsPerStore + $MaxProductsPerStore)
    $allProductUrls = @(Get-SitemapUrls $retailer.sitemapIndexUrl 0 $sitemapLimit | Where-Object {
        $_ -match ([string]$retailer.productUrlPattern)
    } | Select-Object -Unique)
    $urls = @($allProductUrls | Select-Object -Skip $SkipProductsPerStore -First $MaxProductsPerStore)
    Write-Host "    product URLs indexed: $($allProductUrls.Count)"
    Write-Host "    product URLs selected: $($urls.Count) (skip $SkipProductsPerStore, max $MaxProductsPerStore)"
    foreach ($url in $urls) {
        $incoming.Add((New-SourceRow $retailer $url))
        if ([int]$retailer.rateLimitMs -gt 0 -and $FetchPrices) { Start-Sleep -Milliseconds ([int]$retailer.rateLimitMs) }
    }
}

$existing = @()
if ($Append) { $existing = Read-JsonArray $SourceProductsFile }
$merged = Merge-SourceProducts $existing $incoming.ToArray()
Write-JsonFile $SourceProductsFile $merged
@($merged | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8

Write-Host "Sitemap source products: $($merged.Count)"
$merged | Group-Object storeId | Select-Object Name,Count | Format-Table -AutoSize
Write-Host "Exported $SourceProductsFile"
Write-Host "Exported $SourceProductsCsv"
