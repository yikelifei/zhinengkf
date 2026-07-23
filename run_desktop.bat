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
set "DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\.runtime-stable"
set "DESIGN_PLATFORM_RUNTIME_CONFIG=%DESKTOP_RUNTIME_DIR%\design-platform-config.json"

if not exist node_modules (
  echo [setup] Installing desktop dependencies. This may take a while...
  call npm.cmd install --ignore-scripts
  if errorlevel 1 (
    echo [error] Dependency install failed.
    pause
    exit /b 1
  )
)

echo.
echo [start] Starting desktop services in stable foreground mode...
echo Open workbench: http://127.0.0.1:3100/
echo Keep this window open while using the app.
echo.
call "%DESKTOP_DIR%\start-stable-desktop-foreground.cmd"
if errorlevel 1 (
  echo [error] Desktop services stopped with an error. Check logs under desktop\.runtime-stable\logs.
  echo You can also run E:\zhinengkefu\repair-stable-desktop.cmd.
  pause
  exit /b 1
)
