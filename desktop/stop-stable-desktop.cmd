@echo off
setlocal
set DESKTOP_RUNTIME_DIR=D:\zhinengkefu\desktop\.runtime-stable
set FORCE_PORTS_SWEEP=1
cd /d D:\zhinengkefu\desktop
call npm.cmd run ports:stop
