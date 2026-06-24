@echo off
call "%~dp0..\_run_python_task.bat" scripts\check_launch_readiness.py %*
exit /b %errorlevel%
