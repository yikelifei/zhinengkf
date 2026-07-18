@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
set "SKIP_EXISTING_API_BUILD=1"
set "SKIP_EXISTING_WEB_BUILD=1"
set "FORCE_PORTS_SWEEP=1"
set "STABLE_WECHAT_BRIDGE_MODE=dispatch"
set "STABLE_PERSONAL_WECHAT_SEND=0"
set "STABLE_STOP_REQUEST=%DESKTOP_RUNTIME_DIR%\stable-runtime-stop-request"
cd /d "%DESKTOP_ROOT%"
if not exist "%DESKTOP_RUNTIME_DIR%" mkdir "%DESKTOP_RUNTIME_DIR%"
if not exist "%DESKTOP_ROOT%\dist\apps\api\main.js" call npm.cmd run build:api
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
:restart
if exist "%STABLE_STOP_REQUEST%" exit /b 0
echo [%date% %time%] stable-runtime starting stable-runtime-launcher >> "%DESKTOP_RUNTIME_DIR%\keepalive-wrapper.log"
node tools\stable-runtime-launcher.js >> "%DESKTOP_RUNTIME_DIR%\keepalive-wrapper.log" 2>&1
set STABLE_RUNTIME_EXIT_CODE=%ERRORLEVEL%
echo [%date% %time%] stable-runtime exited with %STABLE_RUNTIME_EXIT_CODE% >> "%DESKTOP_RUNTIME_DIR%\keepalive-wrapper.log"
if exist "%STABLE_STOP_REQUEST%" exit /b 0
if %STABLE_RUNTIME_EXIT_CODE% EQU 0 (
  node tools\stable-start-needed.js
  if not errorlevel 1 (
    echo [%date% %time%] stable-runtime exited cleanly while services are healthy; continuing guard >> "%DESKTOP_RUNTIME_DIR%\keepalive-wrapper.log"
    timeout /t 5 /nobreak >nul
    goto restart
  )
)
timeout /t 2 /nobreak >nul
goto restart
