@echo off
setlocal

rem Start AgentHub from the repository root.
rem pushd also maps UNC paths like \\server\share to a temporary drive.
pushd "%~dp0" || (
  echo Failed to enter script directory.
  pause
  exit /b 1
)

if not exist "desktop\package.json" (
  echo desktop\package.json was not found.
  echo Please run this script from the AgentHub repository root.
  popd
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Please install Node.js, then run this script again.
  popd
  pause
  exit /b 1
)

cd /d desktop

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    popd
    pause
    exit /b 1
  )
)

echo Starting AgentHub...
call npm run dev
set "AGENTHUB_EXIT_CODE=%ERRORLEVEL%"

popd

if not "%AGENTHUB_EXIT_CODE%"=="0" (
  echo AgentHub exited with code %AGENTHUB_EXIT_CODE%.
  pause
)

exit /b %AGENTHUB_EXIT_CODE%
