@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "DESKTOP_DIR=%ROOT_DIR%desktop"

set "DESIGN_PLATFORM_ADAPTER=art_image_local"
if "%DESIGN_PLATFORM_BASE_URL%"=="" set "DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3000"

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
set "START_MOCK_DESIGN_PLATFORM=false"
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

echo [info] Starting with real design platform adapter.
echo [info] Design platform: %DESIGN_PLATFORM_BASE_URL%
echo [info] Make sure the real design platform is already running before submitting real jobs.
echo.

echo [stop] Cleaning old desktop services before startup...
call npm.cmd run ports:stop
echo.

echo [check] Running startup preflight...
call npm.cmd run ports:preflight:real:free
if errorlevel 1 (
  echo.
  echo [repair] Preflight failed. Trying one automatic cleanup, then checking again...
  call npm.cmd run ports:stop
  echo.
  echo [check] Running startup preflight again...
  call npm.cmd run ports:preflight:real:free
  if errorlevel 1 (
    echo [error] Startup preflight still failed. Read the messages above.
    echo Run stop_desktop.bat, approve the Administrator prompt, then run this file again.
    pause
    exit /b 1
  )
)

echo [build] Building API...
call npm.cmd run build:api
if errorlevel 1 (
  echo [error] API build failed. Read the messages above.
  pause
  exit /b 1
)

echo.
echo [start] Starting real-design desktop services in foreground mode...
echo Keep this window open while using the app.
echo Open workbench: http://127.0.0.1:3100/
echo.
call npm.cmd run dev:stack:real
if errorlevel 1 (
  echo [error] Desktop services stopped with an error. Check logs under desktop\.runtime\logs.
  pause
  exit /b 1
)

echo.
echo [stopped] Desktop services have stopped.
echo.
pause
