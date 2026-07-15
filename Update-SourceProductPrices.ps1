param(
    [string[]]$StoreId = @("pick-n-pay", "checkers", "woolworths"),
    [int]$Limit = 25,
    [switch]$OnlyMissingPrice,
    [int]$MaxPriceAttempts = 1,
    [int]$RetryAfterHours = 24
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueDir = Join-Path $Root "data\catalogue"
$SourcesFile = Join-Path $CatalogueDir "retailer-sources.json"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$SourceProductsCsv = Join-Path $CatalogueDir "source-products.csv"
$CatalogueFile = Join-Path $Root "data\catalogue.json"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $SourceProductsFile)) { throw "Source products not found: $SourceProductsFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -Force NoteProperty $Name $Value }
}

function Get-ExactProduct($Retailer, $Row) {
    $url = [string]$Row.url
    $query = $(if ($Row.productName) { $Row.productName } else { $Row.searchTerm })
    try {
        $page = Fetch-Page $url
        $products = @(Extract-ExactProductPage $Retailer.storeId $page $query $url)
        if ($products.Count -eq 0 -and $Retailer.storeId -in @("pick-n-pay","checkers")) {
            $rendered = Invoke-RenderedPage $url 24000
            if ($rendered) { $products = @(Extract-ExactProductPage $Retailer.storeId $rendered $query $url) }
        }
        return $products | Select-Object -First 1
    } catch {
        Set-Prop $Row "message" $_.Exception.Message
        return $null
    }
}

$sourceConfig = Get-Content -Raw -LiteralPath $SourcesFile | ConvertFrom-Json
$retailerById = @{}
foreach ($retailer in @($sourceConfig.retailers)) { $retailerById[[string]$retailer.storeId] = $retailer }
$storeFilter = @($StoreId | ForEach-Object { $_.ToLowerInvariant() })
$rows = [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)
$retryBefore = (Get-Date).ToUniversalTime().AddHours(-[math]::Max(0, $RetryAfterHours))
$targets = @($rows | Where-Object {
    $attempts = if ($_.priceAttempts) { [int]$_.priceAttempts } else { 0 }
    $lastAttempt = [datetime]::MinValue
    if ($_.lastPriceAttemptAt) { [datetime]::TryParse([string]$_.lastPriceAttemptAt, [ref]$lastAttempt) | Out-Null }
    $_.url -and
    $storeFilter -contains ([string]$_.storeId).ToLowerInvariant() -and
    (-not $OnlyMissingPrice -or -not $_.price) -and
    $attempts -lt $MaxPriceAttempts -and
    $lastAttempt.ToUniversalTime() -le $retryBefore
} | Select-Object -First $Limit)

$updated = 0
$attempted = 0
foreach ($row in $targets) {
    $retailer = $retailerById[[string]$row.storeId]
    if (-not $retailer) { continue }
    $attempted += 1
    $attemptCount = if ($row.priceAttempts) { [int]$row.priceAttempts + 1 } else { 1 }
    Set-Prop $row "priceAttempts" $attemptCount
    Set-Prop $row "lastPriceAttemptAt" ((Get-Date).ToUniversalTime().ToString("o"))
    Write-Host "[$attempted/$($targets.Count)] $($row.storeName): $($row.productName)"
    $product = Get-ExactProduct $retailer $row
    if ($product -and $product.price) {
        Set-Prop $row "productName" $product.name
        Set-Prop $row "price" $product.price
        Set-Prop $row "regularPrice" $product.regularPrice
        Set-Prop $row "promoText" $product.promoText
        Set-Prop $row "promoType" $product.promoType
        Set-Prop $row "promoApplied" $product.promoApplied
        Set-Prop $row "status" "priced"
        Set-Prop $row "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
        $measure = Get-ProductMeasure $product.name $row.url $row.searchTerm
        if ($measure) {
            Set-Prop $row "size" $measure.label
            Set-Prop $row "unit" $measure.unit
        }
        $updated += 1
        Write-Host "    priced R$($product.price)"
    } else {
        Set-Prop $row "status" "price-missing"
        Set-Prop $row "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
        Write-Host "    no price"
    }
}

Write-JsonFile $SourceProductsFile $rows
@($rows | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $SourceProductsCsv -NoTypeInformation -Encoding UTF8

# Keep already-published catalogue matches current as soon as a source price changes.
if ($updated -gt 0 -and (Test-Path -LiteralPath $CatalogueFile)) {
    $catalogue = [object[]](Read-JsonFile $CatalogueFile @())
    $changedById = @{}
    foreach ($row in @($rows | Where-Object { $_.price -and $_.id })) { $changedById[[string]$row.id] = $row }
    foreach ($item in $catalogue) {
        foreach ($store in @($item.stores)) {
            $sourceId = [string]$store.sourceProductId
            if (-not $sourceId -or -not $changedById.ContainsKey($sourceId)) { continue }
            $source = $changedById[$sourceId]
            foreach ($prop in "productName","brand","size","unit","price","regularPrice","promoText","promoType","promoApplied","lastSeenAt") {
                Set-Prop $store $prop $source.$prop
            }
            Set-Prop $store "status" "ok"
        }
    }
    Write-JsonFile $CatalogueFile $catalogue
}

Write-Host "Updated $updated of $attempted source product prices."
