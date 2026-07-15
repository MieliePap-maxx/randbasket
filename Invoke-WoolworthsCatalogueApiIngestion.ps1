param(
    [int]$PageSize = 200,
    [int]$MaxPages = 0,
    [int]$DelayMs = 250,
    [switch]$Append
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"
$Endpoint = "https://wpkmgeuco-zone.cnstrc.com/browse/subtype/foods"
$ApiKey = "key_tw9hKe0fkfgEf36D"

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Get-CategoryHint([string]$Url, [string]$Name) {
    $text = "$Url $Name".ToLowerInvariant()
    if ($text -match "milk-dairy-eggs|milk|cheese|yoghurt|yogurt|butter|cream") { return "Dairy" }
    if ($text -match "bakery|bread|roll|cake|pastr") { return "Bakery" }
    if ($text -match "meat-poultry-fish|beef|chicken|pork|lamb|mince|fish|seafood|wors") { return "Meat" }
    if ($text -match "fruit-vegetables|fruit|vegetable|salad|potato|tomato|onion") { return "Fruit & Vegetables" }
    if ($text -match "beverages|juice|coffee|tea|water|cooldrink") { return "Beverages" }
    if ($text -match "chocolate|sweets|snacks|dessert|pudding|custard|ice-cream") { return "Desserts" }
    if ($text -match "household|clean|laundry|dishwash|paper-towel|toilet-paper") { return "Cleaning & Household" }
    if ($text -match "toiletries|tooth|personal-care|body-care|pharmacy") { return "Personal Care" }
    if ($text -match "baby|nappies|formula") { return "Baby" }
    if ($text -match "pet|dog|cat") { return "Pets" }
    if ($text -match "pantry|rice|pasta|flour|sugar|oil|sauce|spice|cereal|canned") { return "Pantry" }
    if ($text -match "frozen-food") { return "Frozen" }
    if ($text -match "ready-meals") { return "Ready Meals" }
    return "Food"
}

function Get-Number($Value) {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    try { return [math]::Round([double]$Value, 2) } catch { return $null }
}

function Repair-Text([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch "Ã|Â|â") { return $Value }
    try {
        return [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1252).GetBytes($Value))
    } catch { return $Value }
}

function New-SourceRow($Result) {
    $data = $Result.data
    $name = Repair-Text (Clean-Text $(if ($Result.value) { $Result.value } else { $data.description }))
    $relativeUrl = [string]$data.url
    $url = if ($relativeUrl -match "^https?://") { $relativeUrl } else { "https://www.woolworths.co.za/" + $relativeUrl.TrimStart("/") }
    $price = Get-Number $data.p10
    if ($null -eq $price) { $price = Get-Number $data.p30 }
    if ($null -eq $price) { $price = Get-Number $data.p60 }
    $wasPrice = Get-Number $data.p10_wp
    if ($null -eq $wasPrice -or $wasPrice -le $price) { $wasPrice = $null }
    $measure = Get-ProductMeasure $name $url $name
    return [pscustomobject]@{
        id = "woolworths-" + [string]$data.id
        retailerProductId = [string]$data.id
        storeId = "woolworths"
        storeName = "Woolworths"
        source = "retailer-api"
        searchTerm = ""
        categoryHint = Get-CategoryHint $url $name
        productName = $name
        brand = Repair-Text (Clean-Text $data.brand)
        size = $(if ($measure) { $measure.label } else { "" })
        unit = $(if ($measure) { $measure.unit } else { "" })
        price = $price
        regularPrice = $wasPrice
        promoText = $(if ($wasPrice) { "Woolworths sale" } else { "" })
        promoType = $(if ($wasPrice) { "sale" } else { "" })
        promoApplied = [bool]$wasPrice
        regionalPrices = [pscustomobject]@{
            p10 = Get-Number $data.p10
            p30 = Get-Number $data.p30
            p60 = Get-Number $data.p60
        }
        priceRegion = "p10-default"
        imageUrl = [string]$data.image_url
        url = $url
        status = $(if ($price) { "priced" } else { "price-missing" })
        reviewStatus = "unreviewed"
        published = $false
        score = 1
        discoveredAt = (Get-Date).ToUniversalTime().ToString("o")
        lastSeenAt = (Get-Date).ToUniversalTime().ToString("o")
        searchUrl = ""
    }
}

function Merge-Products($Existing, $Incoming) {
    $rows = [System.Collections.Generic.List[object]]::new()
    $byKey = @{}
    foreach ($row in @($Existing)) {
        $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.url)"
        if (-not $row.url) { $key = "$(Clean-Text $row.storeId)|name|$(Clean-Text $row.productName)" }
        if ($byKey.ContainsKey($key)) { continue }
        $byKey[$key] = $row
        $rows.Add($row)
    }
    foreach ($row in @($Incoming)) {
        $key = "$(Clean-Text $row.storeId)|$(Clean-Text $row.url)"
        if ($byKey.ContainsKey($key)) {
            $existing = $byKey[$key]
            foreach ($prop in $row.PSObject.Properties) {
                if ($prop.Name -in @("id", "published", "publishedAt", "reviewStatus", "discoveredAt")) { continue }
                if ($existing.PSObject.Properties.Name -contains $prop.Name) { $existing.($prop.Name) = $prop.Value }
                else { $existing | Add-Member -Force NoteProperty $prop.Name $prop.Value }
            }
        } else {
            $byKey[$key] = $row
            $rows.Add($row)
        }
    }
    return [object[]]$rows.ToArray()
}

New-Item -ItemType Directory -Force -Path $CatalogueDir | Out-Null
$clientId = [guid]::NewGuid().ToString()
$page = 1
$totalPages = 1
$incoming = [System.Collections.Generic.List[object]]::new()
$headers = @{
    "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    "Origin" = "https://www.woolworths.co.za"
    "Referer" = "https://www.woolworths.co.za/"
}

do {
    $query = "key=$ApiKey&filters%5Bvisibility%5D=all&filters%5Bvisibility%5D=web%20and%20app&num_results_per_page=$PageSize&page=$page&us=default&i=$clientId&s=1"
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Endpoint`?$query" -Headers $headers -TimeoutSec 45
    $payload = $response.Content | ConvertFrom-Json
    $results = @($payload.response.results)
    $total = [int]$payload.response.total_num_results
    $totalPages = [math]::Ceiling($total / [double]$PageSize)
    if ($MaxPages -gt 0) { $totalPages = [math]::Min($totalPages, $MaxPages) }
    Write-Host "Woolworths API page $page of $totalPages ($($results.Count) products, $total total)"
    foreach ($result in $results) { $incoming.Add((New-SourceRow $result)) }
    $page += 1
    if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
} while ($page -le $totalPages)

$existing = @()
if ($Append -and (Test-Path -LiteralPath $SourceProductsFile)) {
    $existing = [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)
}
$merged = Merge-Products $existing $incoming.ToArray()
Write-JsonFile $SourceProductsFile $merged
@($merged | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8

Write-Host "Woolworths API products imported: $($incoming.Count)"
$merged | Group-Object storeId | Select-Object Name,Count | Format-Table -AutoSize
