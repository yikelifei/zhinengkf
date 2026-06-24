@echo off
call "%~dp0..\_run_python_task.bat" scripts\business_hours_audit.py %*
exit /b %errorlevel%
