@echo off
setlocal
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"
set "DESKTOP_ROOT=%PROJECT_ROOT%\desktop"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
if not defined WEB_URL set "WEB_URL=http://127.0.0.1:3100/overview"

if not exist "%DESKTOP_ROOT%\launch-stable-desktop-app.cmd" (
  echo [error] Stable desktop launcher was not found:
  echo %DESKTOP_ROOT%\launch-stable-desktop-app.cmd
  pause
  exit /b 1
)

echo.
echo [start] Starting Smart Kefu stable desktop.
echo [url]   %WEB_URL%
echo.
call "%DESKTOP_ROOT%\launch-stable-desktop-app.cmd"
exit /b %ERRORLEVEL%
