@echo off
setlocal
cd /d "E:\zhinengkefu\desktop"
set "SMART_KEFU_LOG=E:\zhinengkefu\desktop\.runtime-stable\wechat-fixed-egress-ui.log"
echo Fixed-egress deployment started. Please keep this window open.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\deploy-wechat-fixed-egress.ps1" > "%SMART_KEFU_LOG%" 2>&1
set "SMART_KEFU_EXIT_CODE=%ERRORLEVEL%"
type "%SMART_KEFU_LOG%"
echo.
echo Exit code: %SMART_KEFU_EXIT_CODE%
pause
exit /b %SMART_KEFU_EXIT_CODE%
