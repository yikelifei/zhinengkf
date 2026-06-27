@echo off
setlocal
set "DESKTOP_DIR=%~dp0desktop"

if /I not "%~1"=="--elevated" (
  net session >nul 2>nul
  if errorlevel 1 (
    echo [admin] Requesting Administrator permission to stop occupied desktop ports...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--elevated' -Verb RunAs"
    exit /b 0
  )
)

if not exist "%DESKTOP_DIR%\package.json" (
  echo [error] Desktop app folder not found: %DESKTOP_DIR%
  pause
  exit /b 1
)

cd /d "%DESKTOP_DIR%"
call npm.cmd run ports:stop
if errorlevel 1 (
  echo.
  echo [warn] Some ports could not be stopped.
  echo Close the listed PID in Task Manager, or run this file as Administrator.
)
echo.
echo [status] Service status after stop:
call npm.cmd run ports:status
pause
