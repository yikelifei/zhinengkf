@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "DESKTOP_DIR=%ROOT_DIR%desktop"

if not exist "%DESKTOP_DIR%\package.json" (
  echo [FAIL] Desktop package not found: %DESKTOP_DIR%
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js 20 or newer is required.
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm.cmd was not found.
  exit /b 1
)

cd /d "%DESKTOP_DIR%"
set "NEXT_TELEMETRY_DISABLED=1"
set "USE_LOCAL_STORE=true"

call npm.cmd run release:gate
set "RC=%ERRORLEVEL%"

echo.
echo Report: %DESKTOP_DIR%\.runtime\production-release-gate\latest.md
exit /b %RC%
