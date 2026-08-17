@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DESKTOP_ROOT%\tools\start-hidden-stable-app.ps1" -Mode open
exit /b %ERRORLEVEL%
