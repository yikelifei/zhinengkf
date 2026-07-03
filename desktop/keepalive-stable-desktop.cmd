@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set SKIP_EXISTING_API_BUILD=1
set SKIP_EXISTING_WEB_BUILD=1
set FORCE_PORTS_SWEEP=1
cd /d D:\zhinengkefu\desktop
if not exist "D:\zhinengkefu\desktop\.runtime-stable" mkdir "D:\zhinengkefu\desktop\.runtime-stable"
:restart
echo [%date% %time%] stable-runtime starting >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log"
node tools\stable-runtime-launcher.js >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log" 2>&1
echo [%date% %time%] stable-runtime exited with %ERRORLEVEL% >> "D:\zhinengkefu\desktop\.runtime-stable\keepalive-wrapper.log"
if %ERRORLEVEL% EQU 0 exit /b 0
timeout /t 2 /nobreak >nul
goto restart
