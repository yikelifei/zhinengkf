@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
set "LOG_DIR=%DESKTOP_RUNTIME_DIR%\logs"
echo Stable desktop logs: %LOG_DIR%
echo.
if not exist "%LOG_DIR%" (
  echo No stable desktop logs found yet.
  echo Run "%DESKTOP_ROOT%\repair-stable-desktop.cmd" first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%LOG_DIR%' -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 8 Name,LastWriteTime,Length; Write-Host ''; Get-ChildItem -LiteralPath '%LOG_DIR%' -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 4 | ForEach-Object { Write-Host ('----- ' + $_.Name + ' -----'); Get-Content -LiteralPath $_.FullName -Tail 40 }"
pause
