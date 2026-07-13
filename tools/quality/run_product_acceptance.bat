@echo off
setlocal
set SMART_KEFU_NO_PAUSE=1
cd /d "%~dp0..\..\desktop"
npm.cmd run acceptance:e2e -- %*
exit /b %errorlevel%
