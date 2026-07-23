@echo off
setlocal
cd /d "%~dp0"
echo Repairing stable desktop services.
echo Step 1/2: stopping old managed services.
call "%~dp0stop-stable-desktop.cmd"
echo Step 2/2: starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call "%~dp0start-stable-desktop-foreground.cmd"
