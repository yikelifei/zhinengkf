@echo off
setlocal
set "WEB_URL=http://127.0.0.1:3100/design/zhenxi-ai"
call "%~dp0启动智能客服.cmd"
exit /b %ERRORLEVEL%
