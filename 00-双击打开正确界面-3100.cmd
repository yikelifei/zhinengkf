@echo off
setlocal
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"
set "CORRECT_UI_LAUNCHER=%PROJECT_ROOT%\desktop\launch-stable-desktop-app.cmd"

if not exist "%CORRECT_UI_LAUNCHER%" (
  echo [error] Canonical E-drive launcher was not found:
  echo %CORRECT_UI_LAUNCHER%
  pause
  exit /b 1
)

call "%CORRECT_UI_LAUNCHER%"
endlocal
