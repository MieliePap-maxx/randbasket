$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Root "Grocery Price Checker.vbs"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Grocery Price Checker.lnk"
$WScript = New-Object -ComObject WScript.Shell
$Shortcut = $WScript.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$Shortcut.Arguments = "`"$Launcher`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = "Launch the South Africa Grocery Price Checker"
$Shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,44"
$Shortcut.Save()

Write-Host "Desktop shortcut created:"
Write-Host $ShortcutPath
