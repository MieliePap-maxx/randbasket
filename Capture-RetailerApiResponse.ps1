param(
    [Parameter(Mandatory = $true)]
    [string]$PageUrl,
    [Parameter(Mandatory = $true)]
    [string]$UrlPattern,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [string]$BodyPattern = "",
    [int]$WaitMs = 45000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:GPC_IMPORT_ONLY = "1"
. (Join-Path $Root "server.ps1")

function Receive-CdpMessage($Socket, [int]$TimeoutMs) {
    $message = ""
    $cancellation = [Threading.CancellationTokenSource]::new($TimeoutMs)
    try {
        while ($true) {
            $buffer = New-Object byte[] 4194304
            $result = $Socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancellation.Token).Result
            $message += [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
            if (-not $result.EndOfMessage) { continue }
            return $message | ConvertFrom-Json
        }
    } finally {
        $cancellation.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $EdgePath)) { throw "Microsoft Edge was not found." }

$profile = Join-Path $DataDir ("edge-api-profile-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$port = Get-FreeTcpPort
$process = $null
$socket = $null

try {
    $edgeArgs = '--disable-gpu --no-first-run --disable-extensions --remote-debugging-port=' + $port + ' --user-data-dir="' + $profile + '" about:blank'
    $process = Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden

    $versionUrl = "http://127.0.0.1:$port/json/version"
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $versionUrl -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) { throw "The browser debugging session did not start." }

    $newTab = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/new?about:blank" -Method Put -TimeoutSec 10
    $tab = $newTab.Content | ConvertFrom-Json
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $socket.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()

    Send-CdpCommand $socket 1 "Page.enable" | Out-Null
    Send-CdpCommand $socket 2 "Network.enable" @{ maxTotalBufferSize = 104857600; maxResourceBufferSize = 10485760 } | Out-Null
    Send-CdpCommand $socket 3 "Page.navigate" @{ url = $PageUrl } | Out-Null

    $deadline = (Get-Date).AddMilliseconds($WaitMs)
    $matchingRequests = @{}
    $requestMetadata = @{}
    $captured = $null
    while ((Get-Date) -lt $deadline -and -not $captured) {
        $remaining = [math]::Max(250, [int](($deadline - (Get-Date)).TotalMilliseconds))
        try { $event = Receive-CdpMessage $socket ([math]::Min($remaining, 3000)) } catch { continue }
        if ($event.method -eq "Network.requestWillBeSent") {
            $requestUrl = [string]$event.params.request.url
            if ($requestUrl -match $UrlPattern) {
                $safeHeaders = [ordered]@{}
                foreach ($header in $event.params.request.headers.PSObject.Properties) {
                    if ($header.Name -in @("Cookie", "Authorization")) { continue }
                    $safeHeaders[$header.Name] = [string]$header.Value
                }
                $requestMetadata[[string]$event.params.requestId] = [pscustomobject]@{
                    method = [string]$event.params.request.method
                    headers = [pscustomobject]$safeHeaders
                    postData = [string]$event.params.request.postData
                }
            }
        }
        if ($event.method -eq "Network.responseReceived") {
            $url = [string]$event.params.response.url
            if ($url -match $UrlPattern -and [int]$event.params.response.status -ge 200 -and [int]$event.params.response.status -lt 300) {
                $requestId = [string]$event.params.requestId
                $metadata = $requestMetadata[$requestId]
                $matchingRequests[[string]$event.params.requestId] = [pscustomobject]@{
                    url = $url
                    status = [int]$event.params.response.status
                    mimeType = [string]$event.params.response.mimeType
                    method = $(if ($metadata) { $metadata.method } else { "" })
                    headers = $(if ($metadata) { $metadata.headers } else { [pscustomobject]@{} })
                    postData = $(if ($metadata) { $metadata.postData } else { "" })
                }
            }
        }
        if ($event.method -ne "Network.loadingFinished") { continue }
        $requestId = [string]$event.params.requestId
        if (-not $matchingRequests.ContainsKey($requestId)) { continue }

        $bodyResponse = Send-CdpCommand $socket 4 "Network.getResponseBody" @{ requestId = $requestId }
        if (-not $bodyResponse.result.body) { continue }
        $body = [string]$bodyResponse.result.body
        if ($bodyResponse.result.base64Encoded) {
            $body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($body))
        }
        if ($BodyPattern -and $body -notmatch $BodyPattern) {
            $matchingRequests.Remove($requestId)
            continue
        }
        $captured = [pscustomobject]@{
            request = $matchingRequests[$requestId]
            body = $body
        }
    }

    if (-not $captured) { throw "No successful API response matched '$UrlPattern' within $WaitMs ms." }
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [IO.File]::WriteAllText($OutputPath, $captured.body, [Text.UTF8Encoding]::new($false))
    [pscustomobject]@{
        outputPath = $OutputPath
        bytes = $captured.body.Length
        status = $captured.request.status
        mimeType = $captured.request.mimeType
        method = $captured.request.method
        requestHeaders = $captured.request.headers
        postData = $captured.request.postData
        url = $captured.request.url
    }
} finally {
    if ($socket) { try { $socket.Dispose() } catch {} }
    if ($process) { try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {} }
    try { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
