@echo off
call "%~dp0..\_run_python_task.bat" scripts\sanitize_public_reports.py %*
exit /b %errorlevel%
