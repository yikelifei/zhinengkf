@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
call "%DESKTOP_ROOT%\prepare-stable-dependencies.cmd"
if errorlevel 1 exit /b %ERRORLEVEL%
set "SKIP_EXISTING_API_BUILD=1"
set "SKIP_EXISTING_WEB_BUILD=1"
set "STABLE_WECHAT_BRIDGE_MODE=dispatch"
set "STABLE_PERSONAL_WECHAT_SEND=0"
set "WEB_URL=http://127.0.0.1:3100/overview"
cd /d "%DESKTOP_ROOT%"
call npm.cmd run stable:doctor -- --wait --wait-ms=5000 --interval-ms=1000
if errorlevel 1 call "%DESKTOP_ROOT%\start-stable-desktop.cmd"
call npm.cmd run stable:doctor -- --wait --wait-ms=120000 --interval-ms=3000
if not %ERRORLEVEL% EQU 0 (
  echo.
  echo [error] Desktop services are not ready.
  echo Run "%DESKTOP_ROOT%\repair-stable-desktop.cmd" if this keeps failing.
  pause
  exit /b %ERRORLEVEL%
)
node tools\launch-stable-electron.js
if errorlevel 1 (
  echo [error] Electron desktop failed to start.
  exit /b %ERRORLEVEL%
)
