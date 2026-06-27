@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "DESKTOP_DIR=%ROOT_DIR%desktop"

set "DESIGN_PLATFORM_ADAPTER=art_image_local"
if "%DESIGN_PLATFORM_BASE_URL%"=="" set "DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3000"

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
call npm.cmd run ports:doctor:real
echo.
pause
