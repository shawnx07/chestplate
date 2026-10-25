@echo off
title Install Chestplate
echo Installing Chestplate... (a permission prompt will appear)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 pause
