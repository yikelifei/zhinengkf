@echo off
if not defined DESKTOP_ROOT exit /b 1
if defined NODE_PATH if exist "%NODE_PATH%\next\package.json" if exist "%NODE_PATH%\@nestjs\core\package.json" exit /b 0
set "NODE_PATH="
for /f "usebackq delims=" %%I in (`node "%DESKTOP_ROOT%\tools\resolve-worktree-node-modules.js" "%DESKTOP_ROOT%"`) do set "NODE_PATH=%%I"
if not defined NODE_PATH (
  echo [error] Workspace dependencies were not found for "%DESKTOP_ROOT%".
  exit /b 1
)
exit /b 0
