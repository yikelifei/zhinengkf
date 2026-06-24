@echo off
call "%~dp0..\_run_python_task.bat" scripts\ui_contract_check.py %*
exit /b %errorlevel%
