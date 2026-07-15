param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$WaitMs = 30000,
    [string]$ResourcePattern = "woolworths|cnstrc|api|search|product|category|browse|graphql"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:GPC_IMPORT_ONLY = "1"
$env:GPC_INCLUDE_RESOURCE_URLS = "1"
. (Join-Path $Root "server.ps1")

$html = Invoke-RenderedPage $Url $WaitMs
if (-not $html) { throw "Rendered page returned no HTML." }

[pscustomobject]@{
    Bytes = $html.Length
    ProductLinks = ([regex]::Matches($html, "/prod/", "IgnoreCase")).Count
    Prices = ([regex]::Matches($html, "R\s*[0-9]+", "IgnoreCase")).Count
}

$resourceBlock = [regex]::Match($html, '<!-- GPC_RESOURCE_URLS\s*(.*?)\s*-->', "Singleline")
if ($resourceBlock.Success) {
    "RESOURCE URLS"
    @($resourceBlock.Groups[1].Value -split "`r?`n") |
        ForEach-Object { [System.Net.WebUtility]::HtmlDecode($_).Trim() } |
        Where-Object { $_ -match $ResourcePattern } |
        Select-Object -Unique |
        Select-Object -First 150
    return
}

[regex]::Matches(
    $html,
    '(?:https?:)?//[^"''<> ]+|/[A-Za-z0-9_?&=./-]*(?:api|search|product|graphql)[A-Za-z0-9_?&=./-]*',
    "IgnoreCase"
) | ForEach-Object { $_.Value } |
    Select-Object -Unique |
    Where-Object { $_ -match "api|search|product|graphql" } |
    Select-Object -First 100
