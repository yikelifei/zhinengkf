@echo off
call "%~dp0..\_run_python_task.bat" scripts\backup_data.py create --label manual %*
exit /b %errorlevel%
