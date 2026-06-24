@echo off
call "%~dp0..\_run_python_task.bat" scripts\sla_monitor.py %*
exit /b %errorlevel%
