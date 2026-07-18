@echo off
setlocal
for %%I in ("%~dp0.") do set "DESKTOP_ROOT=%%~fI"
if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\.runtime-stable"
cd /d "%DESKTOP_ROOT%"
echo Repairing stable desktop services.
echo Step 1/2: stopping old managed services.
call "%DESKTOP_ROOT%\stop-stable-desktop.cmd"
echo Step 2/2: starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call "%DESKTOP_ROOT%\start-stable-desktop-foreground.cmd"
