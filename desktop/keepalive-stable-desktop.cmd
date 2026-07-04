@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set FORCE_PORTS_SWEEP=1
set STABLE_STOP_REQUEST=D:\zhinengkefu\desktop\.runtime-stable\stable-runtime-stop-request
cd /d D:\zhinengkefu\desktop
if not exist "D:\zhinengkefu\desktop\.runtime-stable" mkdir "D:\zhinengkefu\desktop\.runtime-stable"
if not exist "D:\zhinengkefu\desktop\dist\apps\api\main.js" call npm.cmd run build:api
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
:restart
if exist "%STABLE_STOP_REQUEST%" exit /b 0
echo [%date% %time%] stable-runtime starting >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log"
node tools\stable-runtime-launcher.js >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log" 2>&1
set STABLE_RUNTIME_EXIT_CODE=%ERRORLEVEL%
echo [%date% %time%] stable-runtime exited with %STABLE_RUNTIME_EXIT_CODE% >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log"
if exist "%STABLE_STOP_REQUEST%" exit /b 0
if %STABLE_RUNTIME_EXIT_CODE% EQU 0 (
  node tools\stable-start-needed.js
  if not errorlevel 1 (
    echo [%date% %time%] stable-runtime exited cleanly while services are healthy; continuing guard >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log"
    timeout /t 5 /nobreak >nul
    goto restart
  )
)
timeout /t 2 /nobreak >nul
goto restart
