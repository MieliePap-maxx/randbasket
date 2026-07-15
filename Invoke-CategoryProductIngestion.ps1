param(
    [string[]]$StoreId = @("pick-n-pay", "woolworths", "checkers"),
    [int]$SkipCategoriesPerStore = 0,
    [int]$MaxCategoriesPerStore = 5,
    [int]$LimitPerCategory = 24,
    [switch]$NoRendered,
    [switch]$Append
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueDir = Join-Path $Root "data\catalogue"
$CategoriesFile = Join-Path $CatalogueDir "retailer-categories.json"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"
$SourcesFile = Join-Path $CatalogueDir "retailer-sources.json"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $CategoriesFile)) { throw "Run Discover-RetailerCategories.ps1 first." }
if (-not (Test-Path -LiteralPath $SourcesFile)) { throw "Retailer source config not found: $SourcesFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Read-JsonArray($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return [object[]](Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Get-ProductUrlsFromPage($Html, $Retailer) {
    $urls = @()
    foreach ($match in [regex]::Matches($Html, "href\s*=\s*[""']([^""']+)[""']", "IgnoreCase")) {
        $href = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
        if ($href -match "^https?://") { $url = $href }
        elseif ($href.StartsWith("//")) { $url = "https:$href" }
        elseif ($href.StartsWith("/")) { $url = $Retailer.baseUrl.TrimEnd("/") + $href }
        else { continue }
        $url = $url.Split("#")[0]
        if ($Retailer.productUrlPattern -and $url -match ([string]$Retailer.productUrlPattern)) { $urls += $url }
    }
    return @($urls | Select-Object -Unique)
}

function New-SourceProductsFromCategoryPage($Html, $Retailer, $Category) {
    $query = $Category.categoryName
    $products = @(Extract-RenderedProducts $Html $query $Retailer.baseUrl)
    if ($products.Count -eq 0) { $products = @(Extract-LineProducts $Html $query $Retailer.baseUrl) }
    $productUrls = @(Get-ProductUrlsFromPage $Html $Retailer)
    $ranked = @(Dedupe-Products $products | Sort-Object @{ Expression = { -([double]$_.score) } }, @{ Expression = { $_.price } } | Select-Object -First $LimitPerCategory)
    $rows = @()
    $usedUrls = @{}
    foreach ($product in $ranked) {
        $url = $product.url
        if (-not $url) {
            $bestUrl = ""
            $bestScore = 0.0
            foreach ($candidateUrl in $productUrls) {
                if ($usedUrls.ContainsKey($candidateUrl)) { continue }
                $score = Get-ProductScore $product.name (Get-MeasureSafeUrlText $candidateUrl)
                if ($score -gt $bestScore) {
                    $bestScore = $score
                    $bestUrl = $candidateUrl
                }
            }
            if ($bestScore -ge 0.55) { $url = $bestUrl }
        }
        if ($url) { $usedUrls[$url] = $true }
        $measure = Get-ProductMeasure $product.name $url $query
        $rows += [pscustomobject]@{
            id = [guid]::NewGuid().ToString()
            storeId = $Retailer.storeId
            storeName = $Retailer.storeName
            source = "category"
            searchTerm = ""
            categoryHint = $Category.categoryName
            productName = Clean-Text $product.name
            brand = ""
            size = $(if ($measure) { $measure.label } else { "" })
            unit = $(if ($measure) { $measure.unit } else { "" })
            price = $product.price
            regularPrice = $product.regularPrice
            promoText = $product.promoText
            promoType = $product.promoType
            promoApplied = $product.promoApplied
            url = [string]$url
            status = $(if ($url) { "discovered" } else { "needs-url" })
            reviewStatus = "unreviewed"
            published = $false
            score = $product.score
            discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
            lastSeenAt = (Get-Date).ToUniversalTime().ToString("o")
            searchUrl = $Category.url
        }
    }
    return $rows
}

function Merge-SourceProducts($Existing, $Incoming) {
    $byKey = @{}
    $merged = @()
    foreach ($row in @($Existing)) {
        $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.url)|$(Clean-Text $row.productName)"
        if ($byKey.ContainsKey($key)) { continue }
        $byKey[$key] = $row
        $merged += $row
    }
    foreach ($row in @($Incoming)) {
        $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.url)|$(Clean-Text $row.productName)"
        if ($byKey.ContainsKey($key)) {
            $existing = $byKey[$key]
            foreach ($prop in "price","regularPrice","promoText","promoType","promoApplied","score","lastSeenAt","searchUrl","categoryHint","status","source") {
                if ($existing.PSObject.Properties.Name -contains $prop) { $existing.$prop = $row.$prop }
                else { $existing | Add-Member -Force NoteProperty $prop $row.$prop }
            }
        } else {
            $byKey[$key] = $row
            $merged += $row
        }
    }
    return [object[]]$merged
}

$sourceConfig = Get-Content -Raw -LiteralPath $SourcesFile | ConvertFrom-Json
$retailerById = @{}
foreach ($retailer in @($sourceConfig.retailers)) { $retailerById[[string]$retailer.storeId] = $retailer }
$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$categories = Read-JsonArray $CategoriesFile
$incoming = @()

foreach ($group in @($categories | Where-Object { $storeFilter -contains ([string]$_.storeId).ToLowerInvariant() -and -not [string]::IsNullOrWhiteSpace([string]$_.categoryName) } | Group-Object storeId)) {
    $retailer = $retailerById[[string]$group.Name]
    if (-not $retailer) { continue }
    $orderedCategories = @($group.Group | Sort-Object @{ Expression = {
        if ($_.url -match "milk-dairy-eggs|pantry|bakery|meat-poultry-fish|fruit-vegetables|household|baby") { 0 } else { 1 }
    } }, categoryName)
    $selectedCategories = @($orderedCategories | Select-Object -Skip $SkipCategoriesPerStore -First $MaxCategoriesPerStore)
    Write-Host "$($retailer.storeName): categories selected $($selectedCategories.Count) (skip $SkipCategoriesPerStore, max $MaxCategoriesPerStore)"
    foreach ($category in $selectedCategories) {
        Write-Host "$($retailer.storeName): $($category.categoryName)"
        try {
            $page = Fetch-Page $category.url
            $incoming += New-SourceProductsFromCategoryPage $page $retailer $category
        } catch {
            Write-Host "    static category read failed: $($_.Exception.Message)"
        }
        if (-not $NoRendered -and $retailer.renderSearchPages) {
            try {
                $rendered = Invoke-RenderedPage $category.url 22000
                if ($rendered) { $incoming += New-SourceProductsFromCategoryPage $rendered $retailer $category }
            } catch {
                Write-Host "    rendered category read failed: $($_.Exception.Message)"
            }
        }
        if ([int]$retailer.rateLimitMs -gt 0) { Start-Sleep -Milliseconds ([int]$retailer.rateLimitMs) }
    }
}

$existing = @()
if ($Append) { $existing = Read-JsonArray $SourceProductsFile }
$merged = Merge-SourceProducts $existing $incoming
Write-JsonFile $SourceProductsFile $merged
@($merged | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8

Write-Host "Source products after category ingestion: $($merged.Count)"
$merged | Group-Object storeId | Select-Object Name,Count | Format-Table -AutoSize
Write-Host "Exported $SourceProductsFile"
Write-Host "Exported $SourceProductsCsv"
