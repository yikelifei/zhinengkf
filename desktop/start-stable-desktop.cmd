@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
cd /d D:\zhinengkefu\desktop
call npm.cmd run stable:doctor
if %ERRORLEVEL% EQU 0 exit /b 0
set FORCE_PORTS_SWEEP=1
call npm.cmd run ports:stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\zhinengkefu\desktop\tools\start-stable-keepalive.ps1"
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
call npm.cmd run stable:doctor -- --wait --wait-ms=90000
