@echo off
call "%~dp0..\_run_python_task.bat" scripts\run_tests.py %*
exit /b %errorlevel%
