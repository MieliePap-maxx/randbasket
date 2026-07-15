$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerFile = Join-Path $Root "server.ps1"
$CatalogueFile = Join-Path $Root "data\catalogue.json"

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -Force NoteProperty $Name $Value }
}

function Repair-Text([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch "Ã|Â|â") { return $Value }
    try {
        $bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($Value)
        return [Text.Encoding]::UTF8.GetString($bytes)
    } catch { return $Value }
}

function Get-MatchQuality($Store) {
    $score = 0
    $sourceId = [string]$Store.sourceProductId
    if ($sourceId -match "^woolworths-") { $score += 300 }
    elseif ($sourceId) { $score += 200 }
    else { $score += 100 }
    if ($Store.price) { $score += 20 }
    if ($Store.status -eq "ok") { $score += 5 }
    if ($Store.lastSeenAt) { $score += 1 }
    return $score
}

$catalogue = [object[]](Read-JsonFile $CatalogueFile @())
$bestByUrl = @{}
$duplicateCount = 0

foreach ($item in $catalogue) {
    Set-Prop $item "canonicalName" (Repair-Text ([string]$item.canonicalName))
    if ($item.searchTerms) { Set-Prop $item "searchTerms" ([object[]]@($item.searchTerms | ForEach-Object { Repair-Text ([string]$_) })) }
    for ($index = 0; $index -lt @($item.stores).Count; $index++) {
        $store = @($item.stores)[$index]
        Set-Prop $store "productName" (Repair-Text ([string]$store.productName))
        Set-Prop $store "brand" (Repair-Text ([string]$store.brand))
        $url = (Clean-Text $store.url).ToLowerInvariant().TrimEnd("/")
        if (-not $url) { continue }
        $key = "$(Clean-Text $store.storeId)|$url"
        $entry = [pscustomobject]@{ itemId = [string]$item.id; index = $index; quality = Get-MatchQuality $store }
        if (-not $bestByUrl.ContainsKey($key) -or $entry.quality -gt $bestByUrl[$key].quality) {
            if ($bestByUrl.ContainsKey($key)) { $duplicateCount += 1 }
            $bestByUrl[$key] = $entry
        } else {
            $duplicateCount += 1
        }
    }
}

$cleanCatalogue = [System.Collections.Generic.List[object]]::new()
foreach ($item in $catalogue) {
    $keptStores = [System.Collections.Generic.List[object]]::new()
    for ($index = 0; $index -lt @($item.stores).Count; $index++) {
        $store = @($item.stores)[$index]
        $url = (Clean-Text $store.url).ToLowerInvariant().TrimEnd("/")
        if (-not $url) { $keptStores.Add($store); continue }
        $key = "$(Clean-Text $store.storeId)|$url"
        $best = $bestByUrl[$key]
        if ($best.itemId -eq [string]$item.id -and $best.index -eq $index) { $keptStores.Add($store) }
    }
    if ($keptStores.Count -eq 0) { continue }
    Set-Prop $item "stores" ([object[]]$keptStores.ToArray())
    $cleanCatalogue.Add($item)
}

Write-JsonFile $CatalogueFile $cleanCatalogue.ToArray()
Write-Host "Removed $duplicateCount duplicate retailer URL matches."
Write-Host "Catalogue products remaining: $($cleanCatalogue.Count)"
