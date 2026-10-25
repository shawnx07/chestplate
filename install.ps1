#Requires -Version 5.1
# Chestplate installer. Installs to C:\Program Files\Chestplate, adds shortcuts, and sets up Node.js if needed.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit 0
}

$here   = Split-Path -Parent $PSCommandPath
$programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$target = Join-Path $programFiles 'Chestplate'
$version = (Get-Content (Join-Path $here 'app\package.json') -Raw | ConvertFrom-Json).version

function Step($m) { Write-Host "  > $m" -ForegroundColor Cyan }

try {
  Write-Host ""
  Write-Host "  Installing Chestplate $version" -ForegroundColor Magenta
  Write-Host "  Location: $target"
  Write-Host ""

  # make sure it isn't running (it would lock files)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Chestplate*server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Step 'Copying files'
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  & robocopy (Join-Path $here 'app') (Join-Path $target 'app') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying files failed (robocopy exit code $LASTEXITCODE)" }
  Copy-Item (Join-Path $here 'Chestplate.vbs') $target -Force
  Copy-Item (Join-Path $here 'uninstall.ps1') $target -Force
  foreach ($d in 'servers', 'data', 'runtimes', 'backups') { New-Item -ItemType Directory -Force -Path (Join-Path $target $d) | Out-Null }

  Step 'Allowing Chestplate to create servers here without admin prompts'
  # S-1-5-32-545 = the local "Users" group
  & icacls $target /grant '*S-1-5-32-545:(OI)(CI)M' /C | Out-Null

  Step 'Checking Node.js'
  $needNode = $true
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $v = (& node -v) -replace '^v', ''
    if ([version]($v.Split('-')[0]) -ge [version]'18.15.0') { $needNode = $false; Write-Host "    Using Node.js $v from this PC" }
  }
  if ($needNode) {
    Step 'Downloading a private copy of Node.js (about 30 MB)'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $pick = $index | Where-Object { $_.lts -and $_.version -match '^v22\.' } | Select-Object -First 1
    if (-not $pick) { $pick = $index | Where-Object { $_.lts } | Select-Object -First 1 }
    $name = "node-$($pick.version)-win-$arch"
    $zip = Join-Path $env:TEMP "$name.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$($pick.version)/$name.zip" -OutFile $zip
    $tmp = Join-Path $env:TEMP "chestplate-node-$([guid]::NewGuid().ToString('N'))"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $dest = Join-Path $target 'runtime\node'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Join-Path $target 'runtime') | Out-Null
    Move-Item (Join-Path $tmp $name) $dest
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "    Installed Node.js $($pick.version)"
  }

  Step 'Creating shortcuts'
  $shell = New-Object -ComObject WScript.Shell
  $icon  = Join-Path $target 'app\public\chestplate.ico'
  $links = @(
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Chestplate.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Chestplate.lnk')
  )
  foreach ($l in $links) {
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $s.Arguments = "`"$(Join-Path $target 'Chestplate.vbs')`""
    $s.WorkingDirectory = $target
    $s.IconLocation = $icon
    $s.Description = 'Create and manage Minecraft servers on this PC'
    $s.Save()
  }

  Step 'Registering with Windows (Apps & features)'
  $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Chestplate'
  New-Item -Path $key -Force | Out-Null
  $props = @{
    DisplayName     = 'Chestplate'
    DisplayVersion  = $version
    Publisher       = 'Chestplate'
    InstallLocation = $target
    DisplayIcon     = $icon
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $target 'uninstall.ps1')`""
  }
  foreach ($k in $props.Keys) { Set-ItemProperty -Path $key -Name $k -Value $props[$k] }
  Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord

  Write-Host ""
  Write-Host "  Done! Chestplate is installed." -ForegroundColor Green
  Write-Host "  Servers are created in: $(Join-Path $target 'servers')"
  Write-Host ""
  Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$(Join-Path $target 'Chestplate.vbs')`""
  Start-Sleep -Seconds 2
}
catch {
  Write-Host ""
  Write-Host "  Installation failed: $($_.Exception.Message)" -ForegroundColor Red
  Read-Host '  Press Enter to close'
  exit 1
}
