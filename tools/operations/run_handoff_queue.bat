@echo off
call "%~dp0..\_run_python_task.bat" scripts\handoff_queue.py %*
exit /b %errorlevel%
