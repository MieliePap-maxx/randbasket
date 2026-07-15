$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Server = Join-Path $Root "server.ps1"
$NationalImporter = Join-Path $Root "Run-NationalCatalogueImport.ps1"
$NationalImportState = Join-Path $Root "data\catalogue\national-import-state.json"
$NationalImportLock = Join-Path $Root "data\catalogue\national-import.lock"
$LogDir = Join-Path $Root "logs"
$Url = "http://127.0.0.1:8765"
$StateUrl = "$Url/api/state"
$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$EdgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

function Test-AppReady {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $StateUrl -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Open-AppWindow {
    if (Test-Path -LiteralPath $EdgePath) {
        Start-Process -FilePath $EdgePath -ArgumentList "--app=$Url"
    } else {
        Start-Process $Url
    }
}

function Start-NationalImporterIfNeeded {
    if (-not (Test-Path -LiteralPath $NationalImporter)) { return }
    if (Test-Path -LiteralPath $NationalImportState) {
        try {
            $state = Get-Content -Raw -LiteralPath $NationalImportState | ConvertFrom-Json
            if ($state.status -eq "complete") { return }
        } catch {}
    }
    if (Test-Path -LiteralPath $NationalImportLock) {
        $importPid = Get-Content -Raw -LiteralPath $NationalImportLock -ErrorAction SilentlyContinue
        if ($importPid -and (Get-Process -Id ([int]$importPid) -ErrorAction SilentlyContinue)) { return }
        Remove-Item -LiteralPath $NationalImportLock -Force -ErrorAction SilentlyContinue
    }
    $importOut = Join-Path $LogDir "national-catalogue-import-launch.out.log"
    $importErr = Join-Path $LogDir "national-catalogue-import-launch.err.log"
    $importArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $NationalImporter + '"'
    Start-Process `
        -FilePath $PowerShell `
        -ArgumentList $importArguments `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $importOut `
        -RedirectStandardError $importErr
}

if (-not (Test-Path -LiteralPath $Server)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Could not find server.ps1 in:`n$Root", "Grocery Price Checker") | Out-Null
    exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-NationalImporterIfNeeded

if (-not (Test-AppReady)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $outLog = Join-Path $LogDir "server-$stamp.out.log"
    $errLog = Join-Path $LogDir "server-$stamp.err.log"
    $serverArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Server + '"'
    Start-Process `
        -FilePath $PowerShell `
        -ArgumentList $serverArguments `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-AppReady) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("The Grocery Price Checker server did not start yet. Check the logs folder for details.", "Grocery Price Checker") | Out-Null
        exit 1
    }
}

Open-AppWindow
