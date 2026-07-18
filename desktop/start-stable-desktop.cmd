@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
if not "%STABLE_SERVICE_WINDOW%"=="1" (
  cd /d "%DESKTOP_ROOT%"
  node tools\stable-start-needed.js
  if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DESKTOP_ROOT%\tools\start-stable-keepalive.ps1"
    if errorlevel 1 echo [%date% %time%] failed to start stable keepalive with %ERRORLEVEL% >> "%DESKTOP_RUNTIME_DIR%\stable-service-window.log"
    exit /b 0
  )
  exit /b 0
)
if not exist "%DESKTOP_RUNTIME_DIR%" mkdir "%DESKTOP_RUNTIME_DIR%"
if exist "%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request" del /f /q "%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request"
echo %date% %time% > "%DESKTOP_RUNTIME_DIR%\stable-starting.lock"
set "STABLE_SERVICE_LOG=%DESKTOP_RUNTIME_DIR%\stable-service-window.log"
echo [%date% %time%] service window entered >> "%STABLE_SERVICE_LOG%"
set "SKIP_EXISTING_WEB_BUILD=1"
set "FORCE_PORTS_SWEEP=1"
set "STABLE_WECHAT_BRIDGE_MODE=dispatch"
set "STABLE_PERSONAL_WECHAT_SEND=0"
cd /d "%DESKTOP_ROOT%"
if not exist "%DESKTOP_ROOT%\dist\apps\api\main.js" call npm.cmd run build:api
if %ERRORLEVEL% NEQ 0 (
  echo [%date% %time%] build:api failed with %ERRORLEVEL% >> "%STABLE_SERVICE_LOG%"
  exit /b %ERRORLEVEL%
)
echo [%date% %time%] checking existing services >> "%STABLE_SERVICE_LOG%"
node tools\stable-start-needed.js
if not errorlevel 1 (
  echo [%date% %time%] services already healthy; entering keepalive guard >> "%STABLE_SERVICE_LOG%"
  goto enter_keepalive
)
echo [%date% %time%] services unhealthy, restarting stack >> "%STABLE_SERVICE_LOG%"
echo [%date% %time%] skip ports:stop inside service window; stable runtime launcher will isolate managed ports >> "%STABLE_SERVICE_LOG%"
if not exist "%DESKTOP_ROOT%\apps\web\.next\standalone\apps\web\server.js" echo [%date% %time%] web standalone missing; runtime will use Next dev fallback >> "%STABLE_SERVICE_LOG%"
:enter_keepalive
echo Stable desktop services are running in this window.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
echo [%date% %time%] entering keepalive >> "%STABLE_SERVICE_LOG%"
call "%DESKTOP_ROOT%\keepalive-stable-desktop.cmd"
