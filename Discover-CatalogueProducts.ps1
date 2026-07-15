param(
    [string[]]$StoreId = @("pick-n-pay", "woolworths", "checkers"),
    [string[]]$Terms = @(),
    [int]$LimitPerTerm = 8,
    [switch]$NoRendered
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$DataDir = Join-Path $Root "data"
$CatalogueFile = Join-Path $DataDir "catalogue.json"
$OutDir = Join-Path $DataDir "catalogue"
$OutJson = Join-Path $OutDir "discovery-candidates.json"
$OutCsv = Join-Path $OutDir "discovery-candidates.csv"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Get-AbsoluteProductUrl($Href, $BaseUrl) {
    if ([string]::IsNullOrWhiteSpace([string]$Href)) { return "" }
    $hrefText = [System.Net.WebUtility]::HtmlDecode([string]$Href)
    if ($hrefText -match "^https?://") { return $hrefText }
    if ($hrefText.StartsWith("//")) { return "https:$hrefText" }
    if ($hrefText.StartsWith("/")) { return $BaseUrl.TrimEnd("/") + $hrefText }
    return ""
}

function Test-StoreProductUrl($StoreId, $Url) {
    if ([string]::IsNullOrWhiteSpace([string]$Url)) { return $false }
    switch ($StoreId) {
        "pick-n-pay" { return $Url -match "pnp\.co\.za/.+/p/[0-9A-Z_]+$|pnp\.co\.za/.+/p/[0-9A-Z_]+[/?]" }
        "woolworths" { return $Url -match "woolworths\.co\.za/prod/.+/_/A-[0-9]+" }
        "checkers" { return $Url -match "checkers\.co\.za/product/.+" }
        default { return $false }
    }
}

function Get-SearchUrl($Store, [string]$Term) {
    $encoded = [Uri]::EscapeDataString($Term).Replace("%20", "+")
    $pathEncoded = [Uri]::EscapeDataString($Term)
    if ($Store.id -eq "woolworths") { return "https://www.woolworths.co.za/browse?searchterm=$pathEncoded&fr=1" }
    return $Store.searchUrl.Replace("{query}", $encoded).Replace("{pathQuery}", $pathEncoded)
}

function Get-TermsFromCatalogue {
    if (-not (Test-Path -LiteralPath $CatalogueFile)) { return @() }
    $terms = New-Object System.Collections.Generic.List[string]
    $catalogue = [object[]](Get-Content -Raw -LiteralPath $CatalogueFile | ConvertFrom-Json)
    foreach ($product in $catalogue) {
        if ($product.canonicalName) { $terms.Add([string]$product.canonicalName) }
        foreach ($term in @($product.searchTerms)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$term)) { $terms.Add([string]$term) }
        }
    }
    return @($terms | Select-Object -Unique)
}

function Find-ProductUrls($Html, $Store, $BaseUrl) {
    $urls = @()
    foreach ($match in [regex]::Matches($Html, "href\s*=\s*[""']([^""']+)[""']", "IgnoreCase")) {
        $url = Get-AbsoluteProductUrl $match.Groups[1].Value $BaseUrl
        if (Test-StoreProductUrl $Store.id $url) { $urls += $url }
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

function Add-CandidatesFromPage($Html, $Store, [string]$Term, [string]$SearchUrl) {
    $base = ([Uri]$SearchUrl).GetLeftPart([System.UriPartial]::Authority)
    $products = @(Extract-RenderedProducts $Html $Term $base)
    if ($products.Count -eq 0) { $products = @(Extract-LineProducts $Html $Term $base) }

    $productUrls = @(Find-ProductUrls $Html $Store $base)
    $candidates = @()
    $ranked = @(Dedupe-Products $products | Sort-Object @{ Expression = { -([double]$_.score) } }, @{ Expression = { $_.price } } | Select-Object -First $LimitPerTerm)
    $usedUrls = @{}
    for ($i = 0; $i -lt $ranked.Count; $i++) {
        $product = $ranked[$i]
        $url = $product.url
        if (-not $url) { $url = Get-BestProductUrlForName $product.name $productUrls $usedUrls }
        if ($url) { $usedUrls[$url] = $true }
        $candidates += [pscustomobject]@{
            status = "review"
            source = "search"
            storeId = $Store.id
            storeName = $Store.name
            searchTerm = $Term
            productName = $product.name
            price = $product.price
            regularPrice = $product.regularPrice
            promoText = $product.promoText
            score = $product.score
            url = $url
            discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
            searchUrl = $SearchUrl
        }
    }
    return $candidates
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$termsToUse = @($Terms | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($termsToUse.Count -eq 0) { $termsToUse = @(Get-TermsFromCatalogue) }
if ($termsToUse.Count -eq 0) { throw "No search terms were provided and the catalogue has no terms." }

$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$candidates = @()
foreach ($store in $Stores) {
    if ($storeFilter.Count -gt 0 -and $storeFilter -notcontains $store.id) { continue }
    foreach ($term in $termsToUse) {
        $searchUrl = Get-SearchUrl $store $term
        Write-Host "$($store.name): $term"
        try {
            $page = Fetch-Page $searchUrl
            $candidates += Add-CandidatesFromPage $page $store $term $searchUrl
        } catch {
            Write-Host "    static read failed: $($_.Exception.Message)"
        }
        if (-not $NoRendered -and $store.id -in @("pick-n-pay", "woolworths", "checkers")) {
            try {
                $rendered = Invoke-RenderedPage $searchUrl
                if ($rendered) { $candidates += Add-CandidatesFromPage $rendered $store $term $searchUrl }
            } catch {
                Write-Host "    rendered read failed: $($_.Exception.Message)"
            }
        }
    }
}

$seen = @{}
$unique = @()
foreach ($candidate in $candidates) {
    $key = "$(Clean-Text $candidate.storeId)|$(Clean-Text $candidate.url)|$(Clean-Text $candidate.productName)|$($candidate.price)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $unique += $candidate
}

Write-JsonFile $OutJson $unique
@($unique | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8

Write-Host "Discovered $($unique.Count) review candidates."
Write-Host "Exported $OutJson"
Write-Host "Exported $OutCsv"
