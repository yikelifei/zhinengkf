@echo off
call "%~dp0..\_run_python_task.bat" scripts\answer_guard_audit.py %*
exit /b %errorlevel%
