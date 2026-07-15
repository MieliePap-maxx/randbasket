@echo off
setlocal
set "APP_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%Install-DesktopShortcut.ps1"
pause
