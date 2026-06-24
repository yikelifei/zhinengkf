@echo off
setlocal
cd /d "%~dp0"
set SMART_KEFU_NO_PAUSE=1
call "%~dp0tools\_run_python_task.bat" scripts\web_console.py
endlocal
