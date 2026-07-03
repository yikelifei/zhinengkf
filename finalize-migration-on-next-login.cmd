@echo off
setlocal
set "LOG=D:\zhinengkefu\finalize-migration-on-next-login.log"
echo [%date% %time%] starting finalize >> "%LOG%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\zhinengkefu\finalize-migration-to-d.ps1" >> "%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"
echo [%date% %time%] exit code %CODE% >> "%LOG%"
if "%CODE%"=="0" (
  del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\finalize-zhinengkefu-migration.cmd" >nul 2>nul
  schtasks.exe /Delete /TN "FinalizeZhinengkefuMigration" /F >> "%LOG%" 2>&1
  reg.exe delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FinalizeZhinengkefuMigration" /f >> "%LOG%" 2>&1
  reg.exe delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v "FinalizeZhinengkefuMigrationOnce" /f >> "%LOG%" 2>&1
)
exit /b %CODE%
