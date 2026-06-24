@echo off
call "%~dp0..\_run_python_task.bat" scripts\generate_acceptance_pack.py %*
exit /b %errorlevel%
