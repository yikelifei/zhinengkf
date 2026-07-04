@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
cd /d D:\zhinengkefu\desktop
call npm.cmd run stable:doctor -- --wait --wait-ms=15000 --interval-ms=3000
