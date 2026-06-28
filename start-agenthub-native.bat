@echo off
setlocal

rem Start AgentHub Native from the repository root.
rem pushd also maps UNC paths like \\server\share to a temporary drive.
pushd "%~dp0" || (
  echo Failed to enter script directory.
  pause
  exit /b 1
)

if not exist "scripts\start-native.ps1" (
  echo scripts\start-native.ps1 was not found.
  echo Please run this script from the AgentHub repository root.
  popd
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo powershell was not found in PATH.
  popd
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\start-native.ps1"
set "AGENTHUB_NATIVE_EXIT_CODE=%ERRORLEVEL%"

popd

if not "%AGENTHUB_NATIVE_EXIT_CODE%"=="0" (
  echo AgentHub Native exited with code %AGENTHUB_NATIVE_EXIT_CODE%.
  pause
)

exit /b %AGENTHUB_NATIVE_EXIT_CODE%
