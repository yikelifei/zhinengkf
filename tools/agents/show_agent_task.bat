@echo off
setlocal
if "%~1"=="" (
  echo Usage: tools\agents\show_agent_task.bat MODULE_ID
  exit /b 2
)
set SMART_KEFU_NO_PAUSE=1
call "%~dp0..\_run_python_task.bat" scripts\agent_task_board.py show %*
