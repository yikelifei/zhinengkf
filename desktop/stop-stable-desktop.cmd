@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
set "FORCE_PORTS_SWEEP=1"
if not exist "%DESKTOP_RUNTIME_DIR%" mkdir "%DESKTOP_RUNTIME_DIR%"
echo stop> "%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request"
schtasks.exe /Delete /TN zhinengkefu_stable_runtime /F >nul 2>nul
cd /d "%DESKTOP_ROOT%"
call npm.cmd run ports:stop
