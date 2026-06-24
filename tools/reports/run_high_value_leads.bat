@echo off
call "%~dp0..\_run_python_task.bat" scripts\high_value_leads.py %*
exit /b %errorlevel%
