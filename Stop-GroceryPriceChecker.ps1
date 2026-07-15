$ErrorActionPreference = "SilentlyContinue"

$port = 8765
$stopped = $false

try {
    $connections = @(Get-NetTCPConnection -LocalPort $port -State Listen)
    foreach ($connection in $connections) {
        $process = Get-Process -Id $connection.OwningProcess
        if ($process.ProcessName -match "powershell|pwsh") {
            Stop-Process -Id $process.Id -Force
            $stopped = $true
        }
    }
} catch {}

if (-not $stopped) {
    $lines = @(netstat -ano | Select-String ":$port\s+.*LISTENING")
    foreach ($line in $lines) {
        $parts = ($line.Line -replace "\s+", " ").Trim().Split(" ")
        $pid = [int]$parts[$parts.Length - 1]
        $process = Get-Process -Id $pid
        if ($process.ProcessName -match "powershell|pwsh") {
            Stop-Process -Id $pid -Force
            $stopped = $true
        }
    }
}

if ($stopped) {
    Write-Host "Grocery Price Checker stopped."
} else {
    Write-Host "No Grocery Price Checker server was running on port $port."
}
