@echo off
setlocal
if not "%STABLE_SERVICE_WINDOW%"=="1" (
  set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
  cd /d D:\zhinengkefu\desktop
  node tools\stable-start-needed.js
  if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\zhinengkefu\desktop\tools\start-stable-keepalive.ps1"
    exit /b 0
  )
  exit /b 0
)
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
if not exist "D:\zhinengkefu\desktop\.runtime-stable" mkdir "D:\zhinengkefu\desktop\.runtime-stable"
echo %date% %time% > "D:\zhinengkefu\desktop\.runtime-stable\stable-starting.lock"
set STABLE_SERVICE_LOG=D:\zhinengkefu\desktop\.runtime-stable\stable-service-window.log
echo [%date% %time%] service window entered >> "%STABLE_SERVICE_LOG%"
set SKIP_EXISTING_WEB_BUILD=1
set FORCE_PORTS_SWEEP=1
cd /d D:\zhinengkefu\desktop
if not exist "D:\zhinengkefu\desktop\dist\apps\api\main.js" call npm.cmd run build:api
if %ERRORLEVEL% NEQ 0 (
  echo [%date% %time%] build:api failed with %ERRORLEVEL% >> "%STABLE_SERVICE_LOG%"
  exit /b %ERRORLEVEL%
)
echo [%date% %time%] checking existing services >> "%STABLE_SERVICE_LOG%"
call npm.cmd run stable:doctor -- --wait --wait-ms=15000 --interval-ms=3000
node tools\stable-start-needed.js
if not errorlevel 1 (
  echo [%date% %time%] services already healthy; entering keepalive guard >> "%STABLE_SERVICE_LOG%"
  goto enter_keepalive
)
echo [%date% %time%] services unhealthy, restarting stack >> "%STABLE_SERVICE_LOG%"
set PORTS_STOP_SKIP_STABLE_SERVICE_WRAPPERS=1
call npm.cmd run ports:stop >> "%STABLE_SERVICE_LOG%" 2>>&1
set PORTS_STOP_SKIP_STABLE_SERVICE_WRAPPERS=
if %ERRORLEVEL% NEQ 0 echo [%date% %time%] ports:stop returned %ERRORLEVEL% >> "%STABLE_SERVICE_LOG%"
if not exist "D:\zhinengkefu\desktop\apps\web\.next\standalone\apps\web\server.js" echo [%date% %time%] web standalone missing; runtime will use Next dev fallback >> "%STABLE_SERVICE_LOG%"
:enter_keepalive
echo Stable desktop services are running in this window.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
echo [%date% %time%] entering keepalive >> "%STABLE_SERVICE_LOG%"
call "D:\zhinengkefu\desktop\keepalive-stable-desktop.cmd"
