@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "DESKTOP_DIR=%ROOT_DIR%desktop"

if not exist "%DESKTOP_DIR%\package.json" (
  echo [error] Desktop app folder not found: %DESKTOP_DIR%
  echo Run this file from the project root folder.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [error] npm.cmd was not found.
  echo Reinstall Node.js, then run this file again.
  pause
  exit /b 1
)

cd /d "%DESKTOP_DIR%"

set "NEXT_TELEMETRY_DISABLED=1"
set "USE_LOCAL_STORE=true"
set "START_MOCK_DESIGN_PLATFORM=true"
set "DESIGN_PLATFORM_ADAPTER=standard_v1"
set "DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3700"
set "DESIGN_PLATFORM_RUNTIME_CONFIG=%DESKTOP_DIR%\.runtime\design-platform-config.json"

if not exist node_modules (
  echo [setup] Installing desktop dependencies. This may take a while...
  call npm.cmd install --ignore-scripts
  if errorlevel 1 (
    echo [error] Dependency install failed.
    pause
    exit /b 1
  )
)

echo [stop] Cleaning old desktop services before startup...
call npm.cmd run ports:stop
echo.

echo [check] Running startup preflight...
call npm.cmd run ports:preflight:mock:free
if errorlevel 1 (
  echo.
  echo [repair] Preflight failed. Trying one automatic cleanup, then checking again...
  call npm.cmd run ports:stop
  echo.
  echo [check] Running startup preflight again...
  call npm.cmd run ports:preflight:mock:free
  if errorlevel 1 (
    echo [error] Startup preflight still failed. Read the messages above.
    echo Run stop_desktop.bat, approve the Administrator prompt, then run this file again.
    pause
    exit /b 1
  )
)

echo.
echo [start] Starting desktop services...
echo Open workbench: http://127.0.0.1:3100/
echo.
call npm.cmd run ports:launch:mock
if errorlevel 1 (
  echo [error] Desktop services stopped with an error. Check logs under desktop\.runtime\logs.
  echo You can also run repair_desktop.bat to reset default startup.
  pause
  exit /b 1
)

echo.
echo [check] Verifying desktop startup...
call npm.cmd run ports:doctor:mock
if errorlevel 1 (
  echo [error] Desktop startup check failed. Run repair_desktop.bat, then try again.
  pause
  exit /b 1
)

echo.
echo [ok] Desktop services are running in the background.
echo Open: http://127.0.0.1:3100/
echo To stop them later, run stop_desktop.bat.
echo.
pause
