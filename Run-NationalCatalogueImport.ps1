param(
    [int]$SitemapLimitPerStore = 50000,
    [int]$WoolworthsCategoryBatchSize = 25,
    [int]$WoolworthsProductsPerCategory = 48,
    [int]$PriceBatchSize = 50,
    [int]$MaxPriceAttempts = 1,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$CatalogueDir = Join-Path $Root "data\catalogue"
$StateFile = Join-Path $CatalogueDir "national-import-state.json"
$LockFile = Join-Path $CatalogueDir "national-import.lock"
$LogFile = Join-Path $Root "logs\national-catalogue-import.log"
$SourceProductsFile = Join-Path $CatalogueDir "source-products.json"
$CategoriesFile = Join-Path $CatalogueDir "retailer-categories.json"

New-Item -ItemType Directory -Force -Path $CatalogueDir, (Split-Path -Parent $LogFile) | Out-Null

function Write-State($State) {
    $State.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $State | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Write-RunLog([string]$Message) {
    $line = "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $Message"
    $line | Add-Content -LiteralPath $LogFile -Encoding UTF8
    Write-Host $line
}

function New-State {
    return [pscustomobject]@{
        status = "starting"
        stage = "initialising"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        pickNPaySitemapComplete = $false
        checkersSitemapComplete = $false
        woolworthsCategoriesComplete = $false
        woolworthsCategoryOffset = 0
        initialPublishComplete = $false
        priceStore = ""
        message = "Preparing national catalogue import"
        sourceProductCount = 0
        publishedSourceCount = 0
        pricedSourceCount = 0
    }
}

function Read-State {
    if ($Restart -or -not (Test-Path -LiteralPath $StateFile)) { return New-State }
    return Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
}

function Set-StateProp($State, [string]$Name, $Value) {
    if ($State.PSObject.Properties.Name -contains $Name) { $State.$Name = $Value }
    else { $State | Add-Member -Force NoteProperty $Name $Value }
}

function Update-Counts($State) {
    if (-not (Test-Path -LiteralPath $SourceProductsFile)) { return }
    $rows = [object[]](Get-Content -Raw -LiteralPath $SourceProductsFile | ConvertFrom-Json)
    $State.sourceProductCount = $rows.Count
    $State.publishedSourceCount = @($rows | Where-Object { $_.published -eq $true }).Count
    $State.pricedSourceCount = @($rows | Where-Object { $_.price }).Count
    Write-State $State
}

function Publish-NewProducts($State) {
    $State.stage = "publishing"
    $State.message = "Publishing newly indexed products to the app catalogue"
    Write-State $State
    & (Join-Path $Root "Import-ReviewedSourceProducts.ps1") -Limit 100000 -ImportUnreviewed -SkipWorkbook
    Update-Counts $State
}

if (Test-Path -LiteralPath $LockFile) {
    $lockPid = Get-Content -Raw -LiteralPath $LockFile -ErrorAction SilentlyContinue
    if ($lockPid -and (Get-Process -Id ([int]$lockPid) -ErrorAction SilentlyContinue)) {
        throw "National catalogue import is already running as process $lockPid."
    }
}
$PID | Set-Content -LiteralPath $LockFile -Encoding ASCII

$state = Read-State
$state.status = "running"
Write-State $state

try {
    if (-not $state.pickNPaySitemapComplete) {
        $state.stage = "pick-n-pay-sitemap"
        $state.message = "Indexing the complete Pick n Pay product sitemap"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Invoke-SitemapProductIngestion.ps1") -StoreId "pick-n-pay" -MaxProductsPerStore $SitemapLimitPerStore -Append
        $state.pickNPaySitemapComplete = $true
        Publish-NewProducts $state
    }

    if (-not $state.checkersSitemapComplete) {
        $state.stage = "checkers-sitemap"
        $state.message = "Indexing the complete Checkers product sitemap"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Invoke-SitemapProductIngestion.ps1") -StoreId "checkers" -MaxProductsPerStore $SitemapLimitPerStore -Append
        $state.checkersSitemapComplete = $true
        Publish-NewProducts $state
    }

    if (-not $state.woolworthsCategoriesComplete) {
        $state.stage = "woolworths-api"
        $state.message = "Importing the complete Woolworths food catalogue from its storefront feed"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Invoke-WoolworthsCatalogueApiIngestion.ps1") -Append
        $state.woolworthsCategoriesComplete = $true
        Publish-NewProducts $state
        $state.initialPublishComplete = $true
        Write-State $state
    }

    if (-not $state.initialPublishComplete) {
        Publish-NewProducts $state
        $state.initialPublishComplete = $true
        Write-State $state
    }

    if (-not ($state.PSObject.Properties.Name -contains "dedupeComplete") -or -not $state.dedupeComplete) {
        $state.stage = "deduplicating"
        $state.message = "Removing stale duplicate retailer URLs"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Repair-CatalogueDuplicates.ps1")
        Set-StateProp $state "dedupeComplete" $true
        Write-State $state
    }

    if (-not ($state.PSObject.Properties.Name -contains "pickNPayApiComplete") -or -not $state.pickNPayApiComplete) {
        $state.stage = "pick-n-pay-api"
        $state.message = "Importing Pick n Pay categories, prices, stock and specials"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Invoke-PickNPayCatalogueApiIngestion.ps1")
        Set-StateProp $state "pickNPayApiComplete" $true
        Publish-NewProducts $state
    }

    if (-not ($state.PSObject.Properties.Name -contains "checkersApiComplete") -or -not $state.checkersApiComplete) {
        $state.stage = "checkers-api"
        $state.priceStore = "checkers"
        $state.message = "Importing Checkers regional catalogue prices, stock and specials"
        Write-State $state
        Write-RunLog $state.message
        & (Join-Path $Root "Invoke-CheckersCatalogueApiIngestion.ps1")
        Set-StateProp $state "checkersApiComplete" $true
        Publish-NewProducts $state
    }

    & (Join-Path $Root "Export-CatalogueWorkbook.ps1")
    Update-Counts $state
    $state.status = "complete"
    $state.stage = "complete"
    $state.message = "National catalogue indexing and initial price pass completed"
    Set-StateProp $state "completedAt" ((Get-Date).ToUniversalTime().ToString("o"))
    Write-State $state
    Write-RunLog $state.message
} catch {
    $state.status = "error"
    $state.message = $_.Exception.Message
    Set-StateProp $state "lastError" ($_ | Out-String)
    Write-State $state
    Write-RunLog "ERROR: $($_.Exception.Message)"
    throw
} finally {
    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
}
