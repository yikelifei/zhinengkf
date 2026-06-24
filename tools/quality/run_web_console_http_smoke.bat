@echo off
call "%~dp0..\_run_python_task.bat" scripts\web_console_http_smoke.py %*
exit /b %errorlevel%
