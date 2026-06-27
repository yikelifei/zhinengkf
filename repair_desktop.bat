@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "DESKTOP_DIR=%ROOT_DIR%desktop"

if /I not "%~1"=="--elevated" (
  net session >nul 2>nul
  if errorlevel 1 (
    echo [admin] Requesting Administrator permission to repair occupied desktop ports...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--elevated' -Verb RunAs"
    exit /b 0
  )
)

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

if not exist node_modules (
  echo [setup] Installing desktop dependencies. This may take a while...
  call npm.cmd install --ignore-scripts
  if errorlevel 1 (
    echo [error] Dependency install failed.
    pause
    exit /b 1
  )
)

echo [repair] Repairing default desktop startup...
call npm.cmd run ports:repair
if errorlevel 1 (
  echo.
  echo [error] Repair failed. Read the messages above, then run check_desktop.bat.
  pause
  exit /b 1
)

echo.
echo Repair completed.
echo Now run run_desktop.bat to start the app in foreground mode.
echo.
pause
