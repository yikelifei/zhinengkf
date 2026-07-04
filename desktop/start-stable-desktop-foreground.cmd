@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set FORCE_PORTS_SWEEP=1
set START_SERVICES_THROUGH_WRAPPERS=1
cd /d D:\zhinengkefu\desktop
echo Starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call npm.cmd run ports:stop
if not exist "D:\zhinengkefu\desktop\apps\web\.next\standalone\apps\web\server.js" echo [%date% %time%] web standalone missing; runtime will use Next dev fallback
call "D:\zhinengkefu\desktop\keepalive-stable-desktop.cmd"
