@echo off
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul
cd /d "%~dp0"

echo Starting Smart Bot from: %CD%

set "WECHAT_RUNNING="
tasklist /FI "IMAGENAME eq WeChat.exe" | find /I "WeChat.exe" >nul
if %errorlevel%==0 set "WECHAT_RUNNING=1"
tasklist /FI "IMAGENAME eq Weixin.exe" | find /I "Weixin.exe" >nul
if %errorlevel%==0 set "WECHAT_RUNNING=1"

if not defined WECHAT_RUNNING (
    echo.
    echo ERROR: WeChat is not running.
    echo Open and log in to WeChat 4.x first, then run this file again.
    echo.
    pause
    exit /b 2
)

if exist "dist\smart_bot\smart_bot.exe" goto packaged
if exist ".venv\Scripts\python.exe" goto venv
where python >nul 2>nul
if %errorlevel%==0 goto system_python

echo.
echo ERROR: No runnable Smart Bot target was found.
echo Missing: dist\smart_bot\smart_bot.exe
echo Missing or broken: .venv\Scripts\python.exe
echo Missing: system Python in PATH
echo.
echo Restore the complete Smart Bot package, or install Python and run:
echo   python -m pip install -r requirements.txt
echo.
pause
exit /b 1

:packaged
echo Launch mode: packaged exe
if exist "config\settings.yaml" if exist "dist\smart_bot\_internal\config" (
    echo Syncing config to packaged app...
    copy /Y "config\*.yaml" "dist\smart_bot\_internal\config\" >nul
)
"dist\smart_bot\smart_bot.exe"
set "RC=%errorlevel%"
goto done

:venv
echo Launch mode: project virtual environment
".venv\Scripts\python.exe" scripts\main.py
set "RC=%errorlevel%"
goto done

:system_python
echo Launch mode: system Python
python scripts\main.py
set "RC=%errorlevel%"
goto done

:done
echo.
echo Smart Bot exited with code %RC%.
pause
exit /b %RC%
