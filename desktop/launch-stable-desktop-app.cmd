@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set WEB_URL=http://127.0.0.1:3100
cd /d D:\zhinengkefu\desktop
call D:\zhinengkefu\desktop\start-stable-desktop.cmd
if not %ERRORLEVEL% EQU 0 (
  echo.
  echo [error] Desktop services are not ready.
  echo Run C:\Users\27808\Desktop\zhinengkefu\repair-stable-desktop.cmd and keep that service window open.
  echo Then run this launcher again.
  pause
  exit /b %ERRORLEVEL%
)
start "" cmd /c ".\node_modules\.bin\electron.cmd apps\electron\main.js"
