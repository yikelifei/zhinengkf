@echo off
call "%~dp0..\_run_python_task.bat" scripts\audit_quality.py %*
exit /b %errorlevel%
