@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
set "SKIP_EXISTING_API_BUILD=1"
set "SKIP_EXISTING_WEB_BUILD=1"
set "FORCE_PORTS_SWEEP=1"
set "START_SERVICES_THROUGH_WRAPPERS=1"
set "STABLE_WECHAT_BRIDGE_MODE=dispatch"
set "STABLE_PERSONAL_WECHAT_SEND=0"
cd /d "%DESKTOP_ROOT%"
if not exist "%DESKTOP_RUNTIME_DIR%" mkdir "%DESKTOP_RUNTIME_DIR%"
if exist "%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request" del /f /q "%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request"
echo %date% %time% > "%DESKTOP_RUNTIME_DIR%\stable-starting.lock"
echo Starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call npm.cmd run ports:stop
if not exist "%DESKTOP_ROOT%\apps\web\.next\standalone\apps\web\server.js" echo [%date% %time%] web standalone missing; runtime will use Next dev fallback
call "%DESKTOP_ROOT%\keepalive-stable-desktop.cmd"
