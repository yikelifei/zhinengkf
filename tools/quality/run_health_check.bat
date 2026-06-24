@echo off
call "%~dp0..\_run_python_task.bat" scripts\health_check.py %*
exit /b %errorlevel%
