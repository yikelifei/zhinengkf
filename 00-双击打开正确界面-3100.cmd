@echo off
setlocal
for %%I in ("%~dp0..") do set "UI_VERSIONS_ROOT=%%~fI\zhinengkefu-ui-versions"
set "CORRECT_UI_LAUNCHER=%UI_VERSIONS_ROOT%\modular\desktop\launch-isolated-modular-desktop.cmd"

if not exist "%CORRECT_UI_LAUNCHER%" (
  echo [error] Correct UI launcher was not found:
  echo %CORRECT_UI_LAUNCHER%
  pause
  exit /b 1
)

start "" "%CORRECT_UI_LAUNCHER%"
endlocal
