@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set WEB_URL=http://127.0.0.1:3100
cd /d D:\zhinengkefu\desktop
call npm.cmd run stable:doctor -- --wait --wait-ms=5000 --interval-ms=1000
if %ERRORLEVEL% NEQ 0 call D:\zhinengkefu\desktop\start-stable-desktop.cmd
call npm.cmd run stable:doctor -- --wait --wait-ms=120000 --interval-ms=3000
if not %ERRORLEVEL% EQU 0 (
  echo.
  echo [error] Desktop services are not ready.
  echo Run C:\Users\27808\Desktop\zhinengkefu\repair-stable-desktop.cmd if this keeps failing.
  pause
  exit /b %ERRORLEVEL%
)
start "Smart Kefu App" cmd /c ".\node_modules\.bin\electron.cmd apps\electron\main.js"
