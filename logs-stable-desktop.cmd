@echo off
setlocal
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"
call "%PROJECT_ROOT%\desktop\logs-stable-desktop.cmd" %*
