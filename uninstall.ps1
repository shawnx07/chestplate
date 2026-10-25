#Requires -Version 5.1
# Chestplate uninstaller. Keeps your servers and worlds unless you say otherwise.
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$target = Join-Path $programFiles 'Chestplate'

# run from a temp copy so the install folder isn't locked by this very script
if ($PSScriptRoot -eq $target) {
  $copy = Join-Path $env:TEMP 'chestplate-uninstall.ps1'
  Copy-Item $PSCommandPath $copy -Force
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$copy`"")
  exit 0
}
if (-not $isAdmin) {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit 0
}

Write-Host ""
Write-Host "  Uninstall Chestplate" -ForegroundColor Magenta
$all = Read-Host '  Also delete ALL your servers, worlds and backups? (y/N)'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*Chestplate*server.js*' -or ($_.Name -eq 'java.exe' -and $_.CommandLine -like "*$target*") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

foreach ($l in @((Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Chestplate.lnk'), (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Chestplate.lnk'))) {
  Remove-Item $l -Force -ErrorAction SilentlyContinue
}
Remove-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Chestplate' -Recurse -Force -ErrorAction SilentlyContinue

if ($all -match '^(y|yes)$') {
  Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Removed everything, including your servers." -ForegroundColor Yellow
} else {
  foreach ($d in 'app', 'runtime') { Remove-Item (Join-Path $target $d) -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($f in 'Chestplate.vbs', 'uninstall.ps1') { Remove-Item (Join-Path $target $f) -Force -ErrorAction SilentlyContinue }
  Write-Host "  Chestplate removed. Your servers are still in: $target\servers" -ForegroundColor Green
}
Read-Host '  Press Enter to close'
