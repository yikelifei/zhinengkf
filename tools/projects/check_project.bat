@echo off
setlocal
if "%~1"=="" (
  echo Usage: tools\projects\check_project.bat MODULE_ID
  exit /b 2
)
set SMART_KEFU_NO_PAUSE=1
call "%~dp0..\_run_python_task.bat" scripts\project_modules.py check %*
