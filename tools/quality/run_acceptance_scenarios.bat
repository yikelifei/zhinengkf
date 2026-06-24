@echo off
call "%~dp0..\_run_python_task.bat" scripts\run_acceptance_scenarios.py %*
exit /b %errorlevel%
