@echo off
setlocal
set SMART_KEFU_NO_PAUSE=1
call "%~dp0..\_run_python_task.bat" scripts\project_modules.py list
