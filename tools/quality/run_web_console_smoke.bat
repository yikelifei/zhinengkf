@echo off
call "%~dp0..\_run_python_task.bat" scripts\web_console_smoke.py %*
exit /b %errorlevel%
