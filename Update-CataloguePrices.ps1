param(
    [string[]]$StoreId = @(),
    [int]$Limit = 0,
    [switch]$NoWorkbook
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueFile = Join-Path $Root "data\catalogue.json"
$WorkbookScript = Join-Path $Root "Export-CatalogueWorkbook.ps1"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $CatalogueFile)) { throw "Catalogue file not found: $CatalogueFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Set-ObjectProperty($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -Force NoteProperty $Name $Value
    }
}

function Get-FirstSearchTerm($Product) {
    foreach ($term in @($Product.searchTerms)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$term)) { return [string]$term }
    }
    return [string]$Product.canonicalName
}

function New-CatalogueScanItem($Product, $StoreMatch) {
    $links = [ordered]@{}
    foreach ($store in $Stores) { $links[$store.id] = "" }
    $links[$StoreMatch.storeId] = $StoreMatch.url

    return [pscustomobject]@{
        id = $Product.id
        name = $Product.canonicalName
        query = Get-FirstSearchTerm $Product
        quantity = 1
        category = $Product.category
        targetSize = $Product.targetSize
        links = [pscustomobject]$links
    }
}

function Update-StoreMatchFromScan($Product, $StoreMatch, $Scan) {
    $item = New-CatalogueScanItem $Product $StoreMatch
    $targetMeasure = Get-TargetMeasure $item
    $normalised = $null
    if ($null -ne $Scan.price) {
        $normalised = Get-NormalizedLinePrice $Scan.price $Scan.productMeasure $targetMeasure 1
    }

    Set-ObjectProperty $StoreMatch "status" $Scan.status
    Set-ObjectProperty $StoreMatch "price" $Scan.price
    Set-ObjectProperty $StoreMatch "regularPrice" $Scan.regularPrice
    Set-ObjectProperty $StoreMatch "savings" $Scan.savings
    Set-ObjectProperty $StoreMatch "promoText" $Scan.promoText
    Set-ObjectProperty $StoreMatch "promoType" $Scan.promoType
    Set-ObjectProperty $StoreMatch "promoApplied" $Scan.promoApplied
    Set-ObjectProperty $StoreMatch "normalisedPriceForTarget" $normalised
    Set-ObjectProperty $StoreMatch "normalisedTargetSize" $Product.targetSize
    Set-ObjectProperty $StoreMatch "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
    Set-ObjectProperty $StoreMatch "elapsedMs" $Scan.elapsedMs
    Set-ObjectProperty $StoreMatch "message" $Scan.message

    if ($Scan.productName) { Set-ObjectProperty $StoreMatch "lastMatchedProductName" $Scan.productName }
    if ($Scan.productUrl) { Set-ObjectProperty $StoreMatch "lastMatchedUrl" $Scan.productUrl }
    if ($Scan.productMeasure) { Set-ObjectProperty $StoreMatch "productMeasureLabel" $Scan.productMeasure.label }
}

$catalogue = [object[]](Get-Content -Raw -LiteralPath $CatalogueFile | ConvertFrom-Json)
$storeFilter = @($StoreId | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.ToLowerInvariant() })
$updated = 0
$attempted = 0

foreach ($product in $catalogue) {
    foreach ($storeMatch in @($product.stores)) {
        if (-not $storeMatch.url) { continue }
        if ($storeFilter.Count -gt 0 -and $storeFilter -notcontains ([string]$storeMatch.storeId).ToLowerInvariant()) { continue }
        if ($Limit -gt 0 -and $attempted -ge $Limit) { break }

        $store = $Stores | Where-Object { $_.id -eq $storeMatch.storeId } | Select-Object -First 1
        if (-not $store) {
            Set-ObjectProperty $storeMatch "status" "unsupported-store"
            Set-ObjectProperty $storeMatch "message" "No scraper is configured for this retailer yet."
            continue
        }

        $attempted += 1
        Write-Host "[$attempted] $($store.name): $($product.canonicalName)"
        try {
            $item = New-CatalogueScanItem $product $storeMatch
            $scan = Scan-Store $store $item (Read-JsonFile $SettingsFile $DefaultSettings)
            Update-StoreMatchFromScan $product $storeMatch $scan
            if ($scan.status -eq "ok") { $updated += 1 }
            Write-Host "    $($scan.status) price=$($scan.price) normalised=$($storeMatch.normalisedPriceForTarget)"
        } catch {
            Set-ObjectProperty $storeMatch "status" "error"
            Set-ObjectProperty $storeMatch "message" $_.Exception.Message
            Set-ObjectProperty $storeMatch "lastSeenAt" ((Get-Date).ToUniversalTime().ToString("o"))
            Write-Host "    error $($_.Exception.Message)"
        }
    }
    if ($Limit -gt 0 -and $attempted -ge $Limit) { break }
}

Write-JsonFile $CatalogueFile $catalogue

if (-not $NoWorkbook -and (Test-Path -LiteralPath $WorkbookScript)) {
    & $WorkbookScript
}

Write-Host "Updated $updated of $attempted attempted catalogue prices."
