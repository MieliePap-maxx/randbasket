param(
    [string[]]$StoreId = @("pick-n-pay", "woolworths", "checkers"),
    [string[]]$Terms = @(),
    [int]$MaxTerms = 20,
    [int]$LimitPerTerm = 12,
    [switch]$NoRendered,
    [switch]$Append
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$CatalogueDir = Join-Path $DataDir "catalogue"
$ServerFile = Join-Path $Root "server.ps1"
$SourcesFile = Join-Path $CatalogueDir "retailer-sources.json"
$SeedTermsFile = Join-Path $CatalogueDir "seed-terms.json"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $SourcesFile)) { throw "Retailer source config not found: $SourcesFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Read-JsonArray($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    return [object[]]$value
}

function Get-EnterpriseTerms {
    $explicit = @($Terms | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($explicit.Count -gt 0) { return @($explicit | Select-Object -First $MaxTerms) }
    if (-not (Test-Path -LiteralPath $SeedTermsFile)) { return @() }
    $seed = Get-Content -Raw -LiteralPath $SeedTermsFile | ConvertFrom-Json
    return @($seed.terms | Sort-Object priority, term | Select-Object -First $MaxTerms | ForEach-Object { $_.term })
}

function Get-AbsoluteProductUrl($Href, $BaseUrl) {
    if ([string]::IsNullOrWhiteSpace([string]$Href)) { return "" }
    $hrefText = [System.Net.WebUtility]::HtmlDecode([string]$Href)
    if ($hrefText -match "^https?://") { return $hrefText }
    if ($hrefText.StartsWith("//")) { return "https:$hrefText" }
    if ($hrefText.StartsWith("/")) { return $BaseUrl.TrimEnd("/") + $hrefText }
    return ""
}

function Test-EnterpriseProductUrl($Retailer, $Url) {
    if ([string]::IsNullOrWhiteSpace([string]$Url)) { return $false }
    if (-not $Retailer.productUrlPattern) { return $false }
    return ([string]$Url) -match ([string]$Retailer.productUrlPattern)
}

function Get-EnterpriseSearchUrl($Retailer, [string]$Term) {
    $encoded = [Uri]::EscapeDataString($Term).Replace("%20", "+")
    $pathEncoded = [Uri]::EscapeDataString($Term)
    return ([string]$Retailer.searchTemplate).Replace("{query}", $encoded).Replace("{pathQuery}", $pathEncoded)
}

function Find-EnterpriseProductUrls($Html, $Retailer) {
    $urls = @()
    foreach ($match in [regex]::Matches($Html, "href\s*=\s*[""']([^""']+)[""']", "IgnoreCase")) {
        $url = Get-AbsoluteProductUrl $match.Groups[1].Value $Retailer.baseUrl
        if (Test-EnterpriseProductUrl $Retailer $url) { $urls += $url }
    }
    return @($urls | Select-Object -Unique)
}

function Get-BestProductUrlForName($Name, $Urls, $UsedUrls) {
    $bestUrl = ""
    $bestScore = 0.0
    foreach ($url in @($Urls)) {
        if ($UsedUrls.ContainsKey($url)) { continue }
        $urlText = Get-MeasureSafeUrlText $url
        $score = Get-ProductScore $Name $urlText
        if ($score -gt $bestScore) {
            $bestScore = $score
            $bestUrl = $url
        }
    }
    if ($bestScore -ge 0.55) { return $bestUrl }
    return ""
}

function Get-CategoryHint([string]$Term) {
    if (Test-Path -LiteralPath $SeedTermsFile) {
        $seed = Get-Content -Raw -LiteralPath $SeedTermsFile | ConvertFrom-Json
        $match = @($seed.terms | Where-Object { $_.term -eq $Term } | Select-Object -First 1)
        if ($match.Count -gt 0 -and $match[0].category) { return [string]$match[0].category }
    }
    $lower = $Term.ToLowerInvariant()
    if ($lower -match "tooth|mouth") { return "Personal Care" }
    if ($lower -match "custard|dessert") { return "Desserts" }
    if ($lower -match "milk|cheese|yoghurt") { return "Dairy" }
    if ($lower -match "bread|roll") { return "Bakery" }
    if ($lower -match "clean|dish|washing") { return "Cleaning" }
    return "Uncategorised"
}

function New-SourceProductsFromPage($Html, $Retailer, [string]$Term, [string]$SearchUrl, [string]$CategoryHint) {
    $products = @(Extract-RenderedProducts $Html $Term $Retailer.baseUrl)
    if ($products.Count -eq 0) { $products = @(Extract-LineProducts $Html $Term $Retailer.baseUrl) }
    $productUrls = @(Find-EnterpriseProductUrls $Html $Retailer)
    $ranked = @(Dedupe-Products $products | Sort-Object @{ Expression = { -([double]$_.score) } }, @{ Expression = { $_.price } } | Select-Object -First $LimitPerTerm)
    $usedUrls = @{}
    $rows = @()
    foreach ($product in $ranked) {
        $url = $product.url
        if (-not $url) { $url = Get-BestProductUrlForName $product.name $productUrls $usedUrls }
        if ($url) { $usedUrls[$url] = $true }
        $measure = Get-ProductMeasure $product.name $url $Term
        $rows += [pscustomobject]@{
            id = [guid]::NewGuid().ToString()
            storeId = $Retailer.storeId
            storeName = $Retailer.storeName
            source = "search"
            searchTerm = $Term
            categoryHint = $CategoryHint
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
            searchUrl = $SearchUrl
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
            foreach ($prop in "price","regularPrice","promoText","promoType","promoApplied","score","lastSeenAt","searchUrl","searchTerm","status") {
                if ($existing.PSObject.Properties.Name -contains $prop) {
                    $existing.$prop = $row.$prop
                } else {
                    $existing | Add-Member -Force NoteProperty $prop $row.$prop
                }
            }
        } else {
            $byKey[$key] = $row
            $merged += $row
        }
    }
    return [object[]]$merged
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$sourceConfig = Get-Content -Raw -LiteralPath $SourcesFile | ConvertFrom-Json
$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$termsToUse = @(Get-EnterpriseTerms)
if ($termsToUse.Count -eq 0) { throw "No seed terms found. Add terms to $SeedTermsFile or pass -Terms." }

$incoming = @()
foreach ($retailer in @($sourceConfig.retailers)) {
    if (-not $retailer.enabled) { continue }
    if ($storeFilter.Count -gt 0 -and $storeFilter -notcontains ([string]$retailer.storeId).ToLowerInvariant()) { continue }
    foreach ($term in $termsToUse) {
        $categoryHint = Get-CategoryHint $term
        $searchUrl = Get-EnterpriseSearchUrl $retailer $term
        Write-Host "$($retailer.storeName): $term"
        try {
            $page = Fetch-Page $searchUrl
            $incoming += New-SourceProductsFromPage $page $retailer $term $searchUrl $categoryHint
        } catch {
            Write-Host "    static read failed: $($_.Exception.Message)"
        }
        if (-not $NoRendered -and $retailer.renderSearchPages) {
            try {
                $rendered = Invoke-RenderedPage $searchUrl
                if ($rendered) { $incoming += New-SourceProductsFromPage $rendered $retailer $term $searchUrl $categoryHint }
            } catch {
                Write-Host "    rendered read failed: $($_.Exception.Message)"
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

$summary = $merged | Group-Object storeId | Select-Object Name, Count
Write-Host "Enterprise source products: $($merged.Count)"
$summary | Format-Table -AutoSize
Write-Host "Exported $SourceProductsFile"
Write-Host "Exported $SourceProductsCsv"
