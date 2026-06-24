@echo off
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "PYTHONPATH=%CD%\.codex_deps;%CD%"

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -V >nul 2>nul
  if %errorlevel%==0 goto run
)
where python >nul 2>nul
if %errorlevel%==0 (
  set "PY=python"
  goto run
)
if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
  ".venv\Scripts\python.exe" -V >nul 2>nul
  if %errorlevel%==0 goto run
)

echo ERROR: No Python runtime found.
if "%SMART_KEFU_PAUSE%"=="1" pause
exit /b 1

:run
%PY% %*
set "RC=%errorlevel%"
echo.
echo Command exited with code %RC%.
if "%SMART_KEFU_PAUSE%"=="1" pause
exit /b %RC%
