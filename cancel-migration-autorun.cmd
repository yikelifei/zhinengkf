@echo off
setlocal
reg.exe delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FinalizeZhinengkefuMigration" /f >nul 2>nul
reg.exe delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v "FinalizeZhinengkefuMigrationOnce" /f >nul 2>nul
echo Migration autorun entries removed if they existed.
endlocal
