@echo off
setlocal
cd /d D:\zhinengkefu\desktop
echo Repairing stable desktop services.
echo Step 1/2: stopping old managed services.
call "D:\zhinengkefu\desktop\stop-stable-desktop.cmd"
echo Step 2/2: starting stable desktop services in foreground.
echo Keep this window open. Close it or press Ctrl+C to stop the services.
call "D:\zhinengkefu\desktop\start-stable-desktop-foreground.cmd"
