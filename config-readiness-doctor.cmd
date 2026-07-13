@echo off
call "%~dp0tools\quality\run_config_readiness_doctor.bat" %*
exit /b %errorlevel%
