$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$MobileDir = Join-Path $Root "mobile"
$DepsRoot = "D:\SouthAfricaGroceryPriceCheckerDeps"
$NodeBase = Join-Path $DepsRoot "node"
$RuntimeDir = Join-Path $DepsRoot "mobile-runtime"

if (-not (Test-Path -LiteralPath $NodeBase)) {
    throw "Node is not installed at $NodeBase. Reinstall the mobile dependencies on D drive first."
}

$NodeDir = Get-ChildItem -LiteralPath $NodeBase -Directory -Filter "node-v*-win-x64" |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $NodeDir) {
    throw "Could not find a Node runtime under $NodeBase."
}

$Npm = Join-Path $NodeDir.FullName "npm.cmd"
if (-not (Test-Path -LiteralPath $Npm)) {
    throw "Could not find npm at $Npm."
}

$env:Path = "$($NodeDir.FullName);$env:Path"
$sourceFiles = @("App.tsx", "index.ts", "app.json", "package.json", "tsconfig.json", "metro.config.js")
foreach ($file in $sourceFiles) {
    $src = Join-Path $MobileDir $file
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $RuntimeDir $file) -Force
    }
}
$srcDir = Join-Path $MobileDir "src"
if (Test-Path -LiteralPath $srcDir) {
    Copy-Item -LiteralPath $srcDir -Destination $RuntimeDir -Recurse -Force
}
$env:EXPO_TUNNEL_SUBDOMAIN = "sa-grocery-price-checker-54"
Push-Location $RuntimeDir
try {
    & $Npm exec expo -- start --tunnel --go --clear
} finally {
    Pop-Location
}
