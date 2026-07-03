@echo off
setlocal
set LOG_DIR=D:\zhinengkefu\desktop\.runtime-stable\logs
echo Stable desktop logs: %LOG_DIR%
echo.
if not exist "%LOG_DIR%" (
  echo No stable desktop logs found yet.
  echo Run C:\Users\27808\Desktop\zhinengkefu\repair-stable-desktop.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%LOG_DIR%' -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 8 Name,LastWriteTime,Length; Write-Host ''; Get-ChildItem -LiteralPath '%LOG_DIR%' -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 4 | ForEach-Object { Write-Host ('----- ' + $_.Name + ' -----'); Get-Content -LiteralPath $_.FullName -Tail 40 }"
pause
