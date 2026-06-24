@echo off
call "%~dp0..\_run_python_task.bat" scripts\cleanup_retention.py %*
exit /b %errorlevel%
