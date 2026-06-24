@echo off
call "%~dp0..\_run_python_task.bat" scripts\static_sanity.py %*
exit /b %errorlevel%
