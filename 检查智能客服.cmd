@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "DESKTOP_ROOT=%PROJECT_ROOT%desktop"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"

if not exist "%DESKTOP_ROOT%\package.json" (
  echo [error] Desktop project was not found:
  echo %DESKTOP_ROOT%
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [error] npm.cmd was not found. Reinstall Node.js.
  pause
  exit /b 1
)

cd /d "%DESKTOP_ROOT%"
echo.
echo [check] Checking Smart Kefu startup state...
echo.
call npm.cmd run stable:doctor -- --wait-ms=30000 --interval-ms=2000
echo.
pause
