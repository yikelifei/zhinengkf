@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set FORCE_PORTS_SWEEP=1
if not exist "D:\zhinengkefu\desktop\.runtime-stable" mkdir "D:\zhinengkefu\desktop\.runtime-stable"
echo stop> "D:\zhinengkefu\desktop\.runtime-stable\stable-runtime-stop-request"
schtasks.exe /Delete /TN zhinengkefu_stable_runtime /F >nul 2>nul
cd /d D:\zhinengkefu\desktop
call npm.cmd run ports:stop
