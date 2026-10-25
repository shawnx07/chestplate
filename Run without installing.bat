@echo off
rem Starts Chestplate straight from this folder (needs Node.js 18.15+ installed).
rem Servers and settings are stored in %LOCALAPPDATA%\Chestplate unless you set CHESTPLATE_HOME.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org or use "Install Chestplate.bat" instead.
  pause
  exit /b 1
)
if not defined CHESTPLATE_HOME set "CHESTPLATE_HOME=%LOCALAPPDATA%\Chestplate"
start "" /min node "%~dp0app\server.js"
