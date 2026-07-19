@echo off
setlocal EnableExtensions EnableDelayedExpansion
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "PYTHONPATH=%CD%\.codex_deps;%CD%"
set "SMART_KEFU_TASK_TEMP=%CD%\desktop\.runtime\python-temp"
if not exist "%SMART_KEFU_TASK_TEMP%" mkdir "%SMART_KEFU_TASK_TEMP%" >nul 2>nul
set "TEMP=%SMART_KEFU_TASK_TEMP%"
set "TMP=%SMART_KEFU_TASK_TEMP%"

if defined SMART_KEFU_PYTHON (
  set "PY=%SMART_KEFU_PYTHON%"
  "%SMART_KEFU_PYTHON%" -V >nul 2>nul
  if not errorlevel 1 goto run
  echo ERROR: SMART_KEFU_PYTHON does not point to a working Python runtime.
  exit /b 1
)
if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
  ".venv\Scripts\python.exe" -V >nul 2>nul
  if not errorlevel 1 goto run
)
for /f "delims=" %%I in ('git rev-parse --git-common-dir 2^>nul') do (
  set "LINKED_REPO_PYTHON=%%I\..\.venv\Scripts\python.exe"
  if "%SMART_KEFU_DEBUG_PYTHON%"=="1" echo Linked repository Python candidate: !LINKED_REPO_PYTHON!
  if exist "!LINKED_REPO_PYTHON!" (
    "!LINKED_REPO_PYTHON!" -V >nul 2>nul
    if not errorlevel 1 (
      set "PY=!LINKED_REPO_PYTHON!"
      goto run
    )
  )
)

:bundled_python
if "%SMART_KEFU_DEBUG_PYTHON%"=="1" echo Falling back to bundled or PATH Python.
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -V >nul 2>nul
  if not errorlevel 1 goto run
)
where python >nul 2>nul
if not errorlevel 1 (
  set "PY=python"
  goto run
)

echo ERROR: No Python runtime found.
if "%SMART_KEFU_PAUSE%"=="1" pause
exit /b 1

:run
"!PY!" %*
set "RC=%errorlevel%"
if not "%SMART_KEFU_QUIET_EXIT%"=="1" (
  echo.
  echo Command exited with code %RC%.
)
if "%SMART_KEFU_PAUSE%"=="1" pause
exit /b %RC%
