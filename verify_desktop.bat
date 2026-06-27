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

echo [check] Checking default startup ports...
call npm.cmd run ports:preflight:mock:free
if errorlevel 1 (
  echo.
  echo [error] Ports are not ready for a clean startup.
  echo Run stop_desktop.bat, approve the Administrator prompt, then run this file again.
  pause
  exit /b 1
)

echo.
echo [smoke] Temporarily starting web, API, and mock design platform...
call npm.cmd run ports:smoke
if errorlevel 1 (
  echo.
  echo [error] Startup smoke test failed. Read the messages above.
  pause
  exit /b 1
)

echo.
echo [check] Confirming smoke test released ports...
call npm.cmd run ports:preflight:mock:free
if errorlevel 1 (
  echo.
  echo [warn] Smoke test passed, but a port is still occupied.
  echo Run stop_desktop.bat before starting the app.
  pause
  exit /b 1
)

echo.
echo [ok] Desktop startup verification passed.
echo You can now run run_desktop.bat and keep its window open.
echo.
pause
