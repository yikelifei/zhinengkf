@echo off
setlocal
set "DESKTOP_DIR=%~dp0desktop"

if not exist "%DESKTOP_DIR%\package.json" (
  echo [error] Desktop app folder not found: %DESKTOP_DIR%
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
set "DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\.runtime-stable"
call npm.cmd run stable:doctor
echo.
pause
