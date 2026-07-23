@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0finalize-migration-to-d.ps1"
endlocal
