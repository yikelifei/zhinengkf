@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
cd /d "%DESKTOP_ROOT%"
call npm.cmd run stable:doctor -- --wait --wait-ms=15000 --interval-ms=3000
