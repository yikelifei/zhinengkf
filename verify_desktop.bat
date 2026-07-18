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
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\.runtime-stable"
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

echo [check] Checking stable desktop services...
call npm.cmd run stable:doctor
if errorlevel 1 (
  echo.
  echo [warn] Stable services are not running yet.
  echo Run "%ROOT_DIR%repair-stable-desktop.cmd" and keep that window open.
  pause
  exit /b 1
)

echo.
echo [ok] Desktop startup verification passed.
echo You can now open http://127.0.0.1:3100/overview or run launch-stable-desktop-app.cmd.
echo.
pause
