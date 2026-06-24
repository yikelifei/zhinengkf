@echo off
call "%~dp0..\_run_python_task.bat" scripts\export_audit_log.py %*
exit /b %errorlevel%
