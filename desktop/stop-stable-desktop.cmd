@echo off
setlocal
set DESKTOP_RUNTIME_DIR=%~dp0.runtime-stable
set FORCE_PORTS_SWEEP=1
if not exist "%~dp0.runtime-stable" mkdir "%~dp0.runtime-stable"
echo stop> "%~dp0.runtime-stable\stable-runtime-stop-request"
schtasks.exe /Delete /TN zhinengkefu_stable_runtime /F >nul 2>nul
cd /d "%~dp0"
call npm.cmd run ports:stop
