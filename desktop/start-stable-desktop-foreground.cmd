@echo off
setlocal
set DESKTOP_RUNTIME_DIR=%~dp0.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set FORCE_PORTS_SWEEP=1
set START_SERVICES_THROUGH_WRAPPERS=1
cd /d "%~dp0"
if not exist "%~dp0.runtime-stable" mkdir "%~dp0.runtime-stable"
if exist "%~dp0.runtime-stable\stable-runtime-stop-request" del /f /q "%~dp0.runtime-stable\stable-runtime-stop-request"
echo %date% %time% > "%~dp0.runtime-stable\stable-starting.lock"
echo Starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call npm.cmd run ports:stop
if not exist "%~dp0apps\web\.next\standalone\apps\web\server.js" echo [%date% %time%] web standalone missing; runtime will use Next dev fallback
call "%~dp0keepalive-stable-desktop.cmd"
