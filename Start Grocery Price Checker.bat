@echo off
setlocal

set "APP_DIR=%~dp0"
set "LAUNCHER=%APP_DIR%Launch-GroceryPriceChecker.ps1"

if not exist "%LAUNCHER%" (
  echo Could not find:
  echo %LAUNCHER%
  echo.
  echo Move this folder back to Documents or ask Codex to repair the app launcher.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
