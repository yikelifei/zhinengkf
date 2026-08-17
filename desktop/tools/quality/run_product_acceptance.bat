@echo off
setlocal

cd /d "%~dp0\..\.."
npm.cmd run acceptance:e2e:local-safe -- %*
exit /b %ERRORLEVEL%
