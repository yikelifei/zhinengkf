@echo off
setlocal
set DESKTOP_RUNTIME_DIR=%~dp0.runtime-stable
cd /d "%~dp0"
call npm.cmd run stable:doctor -- --wait --wait-ms=15000 --interval-ms=3000
