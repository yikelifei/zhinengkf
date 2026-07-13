@echo off
set "SMART_KEFU_QUIET_EXIT=1"
call "%~dp0..\_run_python_task.bat" scripts\config_readiness_doctor.py %*
exit /b %errorlevel%
