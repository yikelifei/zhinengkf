@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
set "STABLE_SERVICE_WINDOW=1"
cd /d "%DESKTOP_ROOT%"
call "%DESKTOP_ROOT%\start-stable-desktop.cmd"
