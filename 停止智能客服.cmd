@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "DESKTOP_ROOT=%PROJECT_ROOT%desktop"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"

if not exist "%DESKTOP_ROOT%\stop-stable-desktop.cmd" (
  echo [error] Stop script was not found:
  echo %DESKTOP_ROOT%\stop-stable-desktop.cmd
  pause
  exit /b 1
)

echo.
echo [stop] Stopping Smart Kefu managed services on 3100/3200/3700...
call "%DESKTOP_ROOT%\stop-stable-desktop.cmd"
if errorlevel 1 (
  echo.
  echo [warn] Some service may still be running. Try running this file as Administrator.
  pause
  exit /b 1
)

echo.
echo [ok] Smart Kefu services stopped.
echo.
pause
