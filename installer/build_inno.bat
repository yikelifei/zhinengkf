@echo off
rem Build Inno Setup installer for Smart Bot
rem Usage: run as normal user after installing Inno Setup (ISCC.exe in PATH)

set SCRIPT_DIR=%~dp0
set ISS=%SCRIPT_DIR%smart_bot.iss
set OUTDIR=%~dp0\..\dist

if exist "%ISS%" (
    echo Found ISS: %ISS%
) else (
    echo Cannot find %ISS%
    exit /b 1
)

rem Try to find ISCC
where ISCC >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
        set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    ) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
        set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"
    ) else (
        echo ISCC (Inno Setup compiler) not found in PATH. Install Inno Setup and re-run.
        exit /b 2
    )
) else (
    set ISCC=ISCC
)

%ISCC% /O"%OUTDIR%" "%ISS%"
if errorlevel 1 (
    echo Compilation failed with exit code %errorlevel%
    pause
    exit /b %errorlevel%
)

echo Installer created in %OUTDIR%
pause
