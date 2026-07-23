@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
for /f "usebackq delims=" %%I in (`node "%DESKTOP_ROOT%\tools\resolve-ui-version-runtime.js" modular`) do set "DESKTOP_RUNTIME_DIR=%%I"
if not defined DESKTOP_RUNTIME_DIR (
  echo [error] Modular runtime directory could not be resolved.
  exit /b 1
)
set "WEB_PORT=3110"
set "API_PORT=3210"
set "MOCK_DESIGN_PLATFORM_PORT=3710"
set "WEB_URL=http://127.0.0.1:%WEB_PORT%/overview"
set "DESKTOP_INSTANCE_ID=modular"
set "DESKTOP_APP_TITLE=Smart Kefu - Modular"
call "%DESKTOP_ROOT%\launch-stable-desktop-app.cmd"
