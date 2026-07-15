param(
    [int]$Limit = 50,
    [switch]$ImportUnreviewed,
    [switch]$SkipWorkbook
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$CatalogueDir = Join-Path $DataDir "catalogue"
$ServerFile = Join-Path $Root "server.ps1"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$CatalogueFile = Join-Path $DataDir "catalogue.json"
$WorkbookScript = Join-Path $Root "Export-CatalogueWorkbook.ps1"

if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Server file not found: $ServerFile" }
if (-not (Test-Path -LiteralPath $SourceProductsFile)) { throw "Source products not found: $SourceProductsFile" }

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function New-Slug($Value) {
    $text = (Clean-Text $Value).ToLowerInvariant()
    $text = $text -replace "[^a-z0-9]+", "-"
    $text = $text.Trim("-")
    if (-not $text) { return [guid]::NewGuid().ToString("N") }
    return $text
}

function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -Force NoteProperty $Name $Value }
}

function New-StoreMatchFromSource($Source) {
    return [pscustomobject]@{
        storeId = $Source.storeId
        storeName = $Source.storeName
        productName = $Source.productName
        brand = $Source.brand
        size = $Source.size
        unit = $Source.unit
        url = $Source.url
        imageUrl = $Source.imageUrl
        price = $Source.price
        regularPrice = $Source.regularPrice
        promoText = $Source.promoText
        promoType = $Source.promoType
        promoApplied = $Source.promoApplied
        status = $(if ($Source.price) { "ok" } else { "price-pending" })
        sourceProductId = $Source.id
        lastSeenAt = $Source.lastSeenAt
    }
}

$sources = [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)
$catalogue = [object[]](Read-JsonFile $CatalogueFile @())
$catalogueList = [System.Collections.Generic.List[object]]::new()
$catalogueById = @{}
foreach ($item in $catalogue) {
    $catalogueList.Add($item)
    $catalogueById[[string]$item.id] = $item
}
$eligible = @($sources | Where-Object {
    $_.url -and
    ($ImportUnreviewed -or $_.reviewStatus -eq "approved") -and
    $_.published -ne $true
} | Select-Object -First $Limit)

$imported = 0
foreach ($source in $eligible) {
    $id = New-Slug "$($source.productName)"
    $existing = if ($catalogueById.ContainsKey($id)) { $catalogueById[$id] } else { $null }
    if (-not $existing) {
        $measure = Get-ProductMeasure $source.productName $source.url $source.searchTerm
        $product = [pscustomobject]@{
            id = $id
            canonicalName = $source.productName
            category = $(if ($source.categoryHint) { $source.categoryHint } else { "Uncategorised" })
            targetSize = $(if ($measure) { $measure.label } else { $source.size })
            searchTerms = [object[]]@($source.searchTerm, $source.productName | Where-Object { $_ })
            stores = [object[]]@(New-StoreMatchFromSource $source)
        }
        $catalogueList.Add($product)
        $catalogueById[$id] = $product
    } else {
        $matches = @($existing.stores | Where-Object { $_.storeId -eq $source.storeId -and $_.url -eq $source.url })
        if ($matches.Count -eq 0) {
            $stores = @($existing.stores) + @(New-StoreMatchFromSource $source)
            Set-Prop $existing "stores" ([object[]]$stores)
        } else {
            $match = $matches[0]
            foreach ($prop in "productName","brand","size","unit","url","imageUrl","price","regularPrice","promoText","promoType","promoApplied","lastSeenAt") {
                Set-Prop $match $prop $source.$prop
            }
            Set-Prop $match "sourceProductId" $source.id
            Set-Prop $match "status" $(if ($source.price) { "ok" } else { "price-pending" })
        }
    }
    Set-Prop $source "published" $true
    Set-Prop $source "publishedAt" ((Get-Date).ToUniversalTime().ToString("o"))
    $imported += 1
}

Write-JsonFile $CatalogueFile $catalogueList.ToArray()
Write-JsonFile $SourceProductsFile $sources
if (-not $SkipWorkbook -and (Test-Path -LiteralPath $WorkbookScript)) { & $WorkbookScript }

Write-Host "Imported $imported source products into app catalogue."
