param(
    [Parameter(Mandatory = $true)]
    [string]$RequestId
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$CatalogueDir = Join-Path $DataDir "catalogue"
$RequestsFile = Join-Path $DataDir "catalogue-requests.json"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$CatalogueFile = Join-Path $DataDir "catalogue.json"
$ServerFile = Join-Path $Root "server.ps1"
$IngestionScript = Join-Path $Root "Invoke-EnterpriseCatalogueIngestion.ps1"
$WorkbookScript = Join-Path $Root "Export-CatalogueWorkbook.ps1"

$env:GPC_IMPORT_ONLY = "1"
. $ServerFile

function Read-Array($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return [object[]](Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -Force NoteProperty $Name $Value }
}

function Write-Requests($Requests) {
    Write-JsonFile $RequestsFile ([object[]]$Requests)
}

function Update-Request($Patch) {
    $requests = @(Read-Array $RequestsFile)
    foreach ($request in $requests) {
        if ($request.id -eq $RequestId) {
            foreach ($key in $Patch.Keys) { Set-Prop $request $key $Patch[$key] }
            Set-Prop $request "updatedAt" ((Get-Date).ToUniversalTime().ToString("o"))
            break
        }
    }
    Write-Requests $requests
}

function New-Slug($Value) {
    $text = (Clean-Text $Value).ToLowerInvariant()
    $text = $text -replace "[^a-z0-9]+", "-"
    $text = $text.Trim("-")
    if (-not $text) { return [guid]::NewGuid().ToString("N") }
    return $text
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
        price = $Source.price
        regularPrice = $Source.regularPrice
        promoText = $Source.promoText
        promoType = $Source.promoType
        promoApplied = $Source.promoApplied
        status = "ok"
        sourceProductId = $Source.id
        lastSeenAt = $Source.lastSeenAt
    }
}

function Publish-RequestMatches([string]$Query) {
    $sources = @(Read-Array $SourceProductsFile)
    $catalogue = @(Read-Array $CatalogueFile)
    $matches = @($sources | Where-Object {
        $_.url -and
        (Clean-Text $_.searchTerm).ToLowerInvariant() -eq (Clean-Text $Query).ToLowerInvariant() -and
        $_.published -ne $true
    } | Sort-Object @{ Expression = { -([double]$_.score) } }, productName | Select-Object -First 36)

    $published = 0
    foreach ($source in $matches) {
        $id = New-Slug $source.productName
        $existing = $catalogue | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if (-not $existing) {
            $measure = Get-ProductMeasure $source.productName $source.url $source.searchTerm
            $catalogue += [pscustomobject]@{
                id = $id
                canonicalName = $source.productName
                category = $(if ($source.categoryHint) { $source.categoryHint } else { "Uncategorised" })
                targetSize = $(if ($measure) { $measure.label } else { $source.size })
                searchTerms = [object[]]@($Query, $source.productName | Where-Object { $_ })
                stores = [object[]]@(New-StoreMatchFromSource $source)
            }
        } else {
            $alreadyLinked = @($existing.stores | Where-Object { $_.storeId -eq $source.storeId -and $_.url -eq $source.url }).Count -gt 0
            if (-not $alreadyLinked) {
                Set-Prop $existing "stores" ([object[]](@($existing.stores) + @(New-StoreMatchFromSource $source)))
            }
        }
        Set-Prop $source "published" $true
        Set-Prop $source "publishedAt" ((Get-Date).ToUniversalTime().ToString("o"))
        $published += 1
    }

    Write-JsonFile $CatalogueFile ([object[]]$catalogue)
    Write-JsonFile $SourceProductsFile ([object[]]$sources)
    if (Test-Path -LiteralPath $WorkbookScript) { & $WorkbookScript | Out-Null }
    return $published
}

try {
    $requests = @(Read-Array $RequestsFile)
    $request = $requests | Where-Object { $_.id -eq $RequestId } | Select-Object -First 1
    if (-not $request) { throw "Catalogue request not found: $RequestId" }

    $query = Clean-Text $request.query
    Update-Request @{
        status = "running"
        message = "Searching retailer catalogues"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    & $IngestionScript -Terms $query -MaxTerms 1 -LimitPerTerm 12 -Append | Out-Null

    $sourcesAfter = @(Read-Array $SourceProductsFile)
    $found = @($sourcesAfter | Where-Object {
        (Clean-Text $_.searchTerm).ToLowerInvariant() -eq $query.ToLowerInvariant()
    })
    $published = Publish-RequestMatches $query
    $finalStatus = $(if ($found.Count -gt 0) { "complete" } else { "no-results" })
    $message = $(if ($found.Count -gt 0) { "Found $($found.Count) candidates and published $published catalogue rows" } else { "No retailer candidates found yet" })
    Update-Request @{
        status = $finalStatus
        foundCount = $found.Count
        publishedCount = $published
        message = $message
        completedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
} catch {
    Update-Request @{
        status = "error"
        error = $_.Exception.Message
        message = "Catalogue discovery failed"
        completedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    throw
}
