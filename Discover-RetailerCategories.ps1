param(
    [string[]]$StoreId = @("pick-n-pay", "woolworths", "checkers"),
    [int]$MaxPerStore = 80,
    [switch]$NoRendered,
    [switch]$NoSitemap
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourcesFile = Join-Path $CatalogueDir "retailer-sources.json"
$OutJson = Join-Path $CatalogueDir "retailer-categories.json"
$OutCsv = Join-Path $CatalogueDir "retailer-categories.csv"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $SourcesFile)) { throw "Retailer source config not found: $SourcesFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Get-AbsoluteUrl($Href, $BaseUrl) {
    if ([string]::IsNullOrWhiteSpace([string]$Href)) { return "" }
    $value = [System.Net.WebUtility]::HtmlDecode([string]$Href)
    if ($value -match "^https?://") { return $value.Split("#")[0] }
    if ($value.StartsWith("//")) { return ("https:$value").Split("#")[0] }
    if ($value.StartsWith("/")) { return ($BaseUrl.TrimEnd("/") + $value).Split("#")[0] }
    return ""
}

function Test-PatternList($Patterns, [string]$Url) {
    foreach ($pattern in @($Patterns)) {
        if ($Url -match ([string]$pattern)) { return $true }
    }
    return $false
}

function Test-CategoryUrl($Retailer, [string]$Url) {
    if ([string]::IsNullOrWhiteSpace($Url)) { return $false }
    if ($Retailer.productUrlPattern -and $Url -match ([string]$Retailer.productUrlPattern)) { return $false }
    if ($Url -match "login|checkout|cart|account|register|privacy|terms|help|contact|store-finder|wishlist|search\\?") { return $false }
    if ($Retailer.storeId -eq "woolworths") {
        if ($Url -notmatch "food-south-africa/(milk-dairy-eggs|pantry|bakery|meat-poultry-fish|fruit-vegetables-salads|household|baby|toiletries-health|beverages-juices|puddings-desserts|frozen-food|chocolates-sweets-snacks)") { return $false }
        if ($Url -match "promotions|promotions-specials|all-savings|savings|specials|deals|food-basket|banners|accessories|buy-[0-9]|buy-any|for-r[0-9]|save") { return $false }
    }
    if ($Retailer.categoryUrlPatterns -and (Test-PatternList $Retailer.categoryUrlPatterns $Url)) { return $true }
    return $false
}

function Get-ReadableCategoryName([string]$Url) {
    try {
        $path = ([Uri]$Url).AbsolutePath
    } catch {
        $path = $Url
    }
    $leaf = @($path.Trim("/").Split("/") | Where-Object { $_ -and $_ -notmatch "^c-[0-9]+$|^A-[0-9]+$" } | Select-Object -Last 1)
    if ($leaf.Count -eq 0) { $leaf = @($path.Trim("/")) }
    $name = [Uri]::UnescapeDataString([string]$leaf[0])
    $name = $name -replace "[-_]+", " "
    $name = Clean-Text $name
    if ($name -match "^\d+\s*for\s*r|\bbuy\b|promotion|special|saving|savings|deal|save|off selected") { return "" }
    if (-not $name) { return "Category" }
    return (Get-Culture).TextInfo.ToTitleCase($name.ToLowerInvariant())
}

function Get-CategoryFromProductUrl($Retailer, [string]$Url) {
    if ($Retailer.storeId -ne "pick-n-pay") { return $null }
    try {
        $uri = [Uri]$Url
        $parts = @($uri.AbsolutePath.Trim("/").Split("/") | Where-Object { $_ })
    } catch {
        return $null
    }
    $pIndex = [Array]::IndexOf($parts, "p")
    if ($pIndex -lt 3) { return $null }
    $categoryParts = @($parts[0..($pIndex - 2)])
    if ($categoryParts.Count -lt 2) { return $null }
    $categoryPath = "/" + ($categoryParts -join "/")
    $categoryUrl = $Retailer.baseUrl.TrimEnd("/") + $categoryPath
    $categoryName = Get-ReadableCategoryName $categoryUrl
    if ([string]::IsNullOrWhiteSpace($categoryName)) { return $null }
    return [pscustomobject]@{
        storeId = $Retailer.storeId
        storeName = $Retailer.storeName
        categoryName = $categoryName
        url = $categoryUrl
        source = "product-sitemap-path"
        status = "discovered"
        discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
    }
}

function Find-Links($Html, $Retailer, [string]$Source) {
    $rows = @()
    foreach ($match in [regex]::Matches($Html, "href\s*=\s*[""']([^""']+)[""']", "IgnoreCase")) {
        $url = Get-AbsoluteUrl $match.Groups[1].Value $Retailer.baseUrl
        if (-not (Test-CategoryUrl $Retailer $url)) { continue }
        $categoryName = Get-ReadableCategoryName $url
        if ([string]::IsNullOrWhiteSpace($categoryName)) { continue }
        $rows += [pscustomobject]@{
            storeId = $Retailer.storeId
            storeName = $Retailer.storeName
            categoryName = $categoryName
            url = $url
            source = $Source
            status = "discovered"
            discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
        }
    }
    return $rows
}

function Get-SitemapText([string]$Url) {
    $headers = @{
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        "Accept" = "application/xml,text/xml,text/plain,*/*"
    }
    $response = Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 35
    return [string]$response.Content
}

function Get-SitemapUrls($Url, [int]$Depth = 0) {
    if ([string]::IsNullOrWhiteSpace($Url) -or $Depth -gt 2) { return @() }
    try {
        $xmlText = Get-SitemapText $Url
        [xml]$xml = $xmlText
    } catch {
        Write-Host "    sitemap read failed: $Url - $($_.Exception.Message)"
        return @()
    }
    $urls = @()
    foreach ($loc in @($xml.SelectNodes("//*[local-name()='loc']"))) {
        $value = [string]$loc.InnerText
        if ($value -match "\.xml(\.gz)?$" -and $Depth -lt 2) {
            $urls += Get-SitemapUrls $value ($Depth + 1)
        } else {
            $urls += $value
        }
        if ($urls.Count -ge 50000) { break }
    }
    return $urls
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$sourceConfig = Get-Content -Raw -LiteralPath $SourcesFile | ConvertFrom-Json
$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$discovered = @()

foreach ($retailer in @($sourceConfig.retailers)) {
    if (-not $retailer.enabled) { continue }
    if ($storeFilter.Count -gt 0 -and $storeFilter -notcontains ([string]$retailer.storeId).ToLowerInvariant()) { continue }
    Write-Host "Discovering categories: $($retailer.storeName)"
    try {
        $homePage = Fetch-Page $retailer.baseUrl
        $discovered += Find-Links $homePage $retailer "home-static"
    } catch {
        Write-Host "    home static failed: $($_.Exception.Message)"
    }
    if (-not $NoRendered) {
        try {
            $rendered = Invoke-RenderedPage $retailer.baseUrl 18000
            if ($rendered) { $discovered += Find-Links $rendered $retailer "home-rendered" }
        } catch {
            Write-Host "    home rendered failed: $($_.Exception.Message)"
        }
    }
    if (-not $NoSitemap -and $retailer.sitemapIndexUrl) {
        $sitemapUrls = @(Get-SitemapUrls $retailer.sitemapIndexUrl)
        foreach ($url in $sitemapUrls) {
            if (Test-CategoryUrl $retailer $url) {
                $categoryName = Get-ReadableCategoryName $url
                if ([string]::IsNullOrWhiteSpace($categoryName)) { continue }
                $discovered += [pscustomobject]@{
                    storeId = $retailer.storeId
                    storeName = $retailer.storeName
                    categoryName = $categoryName
                    url = $url
                    source = "sitemap"
                    status = "discovered"
                    discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
                }
            }
            $productCategory = Get-CategoryFromProductUrl $retailer $url
            if ($productCategory) { $discovered += $productCategory }
        }
    }
}

$seen = @{}
$unique = @()
foreach ($row in $discovered) {
    $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.url)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $unique += $row
}

$limited = @()
foreach ($group in @($unique | Group-Object storeId)) {
    $limited += @($group.Group | Sort-Object categoryName | Select-Object -First $MaxPerStore)
}

Write-JsonFile $OutJson ([object[]]$limited)
@($limited | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8

Write-Host "Discovered $($limited.Count) retailer categories."
$limited | Group-Object storeId | Select-Object Name,Count | Format-Table -AutoSize
Write-Host "Exported $OutJson"
Write-Host "Exported $OutCsv"
