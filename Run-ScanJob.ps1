param(
    [Parameter(Mandatory = $true)]
    [string]$JobId
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:GPC_IMPORT_ONLY = "1"
. (Join-Path $Root "server.ps1")

function Save-JobStatus($Patch) {
    Ensure-Files
    $jobs = @(Read-ScanJobs)
    $next = @()
    $found = $false
    foreach ($existing in $jobs) {
        if ($existing.id -eq $JobId) {
            foreach ($prop in $Patch.PSObject.Properties) {
                $existing | Add-Member -Force NoteProperty $prop.Name $prop.Value
            }
            $existing | Add-Member -Force NoteProperty updatedAt ((Get-Date).ToUniversalTime().ToString("o"))
            $next += $existing
            $found = $true
        } else {
            $next += $existing
        }
    }
    if (-not $found) {
        $patchObject = [pscustomobject]@{
            id = $JobId
            status = $(if ($Patch.status) { $Patch.status } else { "running" })
            progress = $(if ($null -ne $Patch.progress) { $Patch.progress } else { 0 })
            completedChecks = $(if ($null -ne $Patch.completedChecks) { $Patch.completedChecks } else { 0 })
            totalChecks = $(if ($null -ne $Patch.totalChecks) { $Patch.totalChecks } else { 1 })
            currentItem = $(if ($Patch.currentItem) { $Patch.currentItem } else { "" })
            currentStore = $(if ($Patch.currentStore) { $Patch.currentStore } else { "" })
            message = $(if ($Patch.message) { $Patch.message } else { "" })
            createdAt = (Get-Date).ToUniversalTime().ToString("o")
            updatedAt = (Get-Date).ToUniversalTime().ToString("o")
            result = $Patch.result
            error = $(if ($Patch.error) { $Patch.error } else { "" })
        }
        $next = @($patchObject) + $next
    }
    Write-ScanJobs (@($next | Select-Object -First 30))
}

function New-ItemScan($Item) {
    return [pscustomobject]@{
        itemId = $Item.id
        name = $Item.name
        query = $(if ($Item.query) { $Item.query } else { $Item.name })
        quantity = $(if ($Item.quantity) { $Item.quantity } else { 1 })
        category = $(if ($Item.category) { $Item.category } else { "" })
        targetSize = $(if ($Item.PSObject.Properties.Name -contains "targetSize") { Clean-Text $Item.targetSize } else { "" })
        targetMeasure = $(Get-TargetMeasure $Item)
        links = $(Normalize-ItemLinks $Item.links)
        results = @()
    }
}

try {
    Ensure-Files
    $items = [object[]](Read-JsonFile $ItemsFile $DefaultItems)
    $settings = Read-JsonFile $SettingsFile $DefaultSettings
    $enabledStores = @(Get-EnabledStores $settings)
    $totalChecks = [math]::Max(1, $items.Count * [math]::Max(1, $enabledStores.Count))
    $completedChecks = 0
    $scans = @()

    Save-JobStatus ([pscustomobject]@{
        status = "running"
        progress = 1
        completedChecks = 0
        totalChecks = $totalChecks
        message = "Starting retailer checks"
        currentItem = ""
        currentStore = ""
    })

    foreach ($item in $items) {
        $itemScan = New-ItemScan $item
        foreach ($store in $enabledStores) {
            Save-JobStatus ([pscustomobject]@{
                status = "running"
                progress = [math]::Min(96, [math]::Round(($completedChecks / $totalChecks) * 96, 0))
                completedChecks = $completedChecks
                totalChecks = $totalChecks
                currentItem = $itemScan.name
                currentStore = $store.name
                message = "Checking $($store.name) for $($itemScan.name)"
            })
            $itemScan.results += Scan-Store $store $item $settings
            $completedChecks += 1
            Save-JobStatus ([pscustomobject]@{
                status = "running"
                progress = [math]::Min(96, [math]::Round(($completedChecks / $totalChecks) * 96, 0))
                completedChecks = $completedChecks
                totalChecks = $totalChecks
                currentItem = $itemScan.name
                currentStore = $store.name
                message = "Finished $($store.name) for $($itemScan.name)"
            })
        }
        $scans += Apply-ValueAdjustments $itemScan
    }

    $basketTotals = [ordered]@{}
    foreach ($store in $enabledStores) {
        $total = 0.0
        $missing = 0
        foreach ($scan in $scans) {
            $result = $scan.results | Where-Object { $_.storeId -eq $store.id } | Select-Object -First 1
            if ($null -eq $result -or $null -eq $result.lineTotal) { $missing += 1 } else { $total += [double]$result.lineTotal }
        }
        $basketTotals[$store.id] = [pscustomobject]@{
            storeId = $store.id
            storeName = $store.name
            total = [math]::Round($total, 2)
            missing = $missing
        }
    }
    $bestBasket = $basketTotals.Values | Where-Object { $_.missing -eq 0 } | Sort-Object total | Select-Object -First 1
    $entry = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        settings = $settings
        items = [object[]]$items
        scans = [object[]]$scans
        basketTotals = $basketTotals
        bestBasketStoreId = $(if ($bestBasket) { $bestBasket.storeId } else { $null })
    }

    $history = Read-JsonFile $HistoryFile @()
    $history = @($entry) + @($history | Select-Object -First 51)
    Write-JsonFile $HistoryFile $history

    Save-JobStatus ([pscustomobject]@{
        status = "complete"
        progress = 100
        completedChecks = $completedChecks
        totalChecks = $totalChecks
        currentItem = ""
        currentStore = ""
        message = "Price check complete"
        result = $entry
        error = ""
    })
} catch {
    Save-JobStatus ([pscustomobject]@{
        status = "error"
        progress = 100
        message = "Price check failed"
        error = $_.Exception.Message
    })
}
