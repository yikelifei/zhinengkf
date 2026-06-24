@echo off
REM Run the bundled PowerShell installer inside the self-extracting package
SETLOCAL
set ZIPPATH=%~dp0smart_bot_installer.zip
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install.ps1" -ZipPath "%ZIPPATH%"
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
	echo Install failed with exit code %RC%
	echo ---- Installer log ----
	type "%TEMP%\smart_bot_install.log"
	echo ------------------------
	pause
)
ENDLOCAL
