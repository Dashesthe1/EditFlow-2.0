$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$root = Join-Path $env:LOCALAPPDATA 'EditFlow2\chat-supervisor'
$extension = Join-Path $env:USERPROFILE 'Downloads\chatgpt_phrase_monitor_chrome'
$backup = Join-Path $root ('backup-supervisor-3-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item $backup -ItemType Directory -Force | Out-Null
New-Item (Join-Path $backup 'extension') -ItemType Directory -Force | Out-Null
foreach ($file in @('supervisor.js','liveness.js','guardian.ps1','recover-extension.ps1','state.json','production-state.json')) {
  if (Test-Path (Join-Path $root $file)) { Copy-Item (Join-Path $root $file) $backup }
}
Get-ChildItem $extension -File | Copy-Item -Destination (Join-Path $backup 'extension')
# Stop only the old supervisor/guardian, leaving AE and the gateway running.
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + (Join-Path $root 'supervisor.js') + '*')) -or
  ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like ('*' + (Join-Path $root 'guardian.ps1') + '*'))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
foreach ($file in @('supervisor.js','liveness.js','guardian.ps1','recover-extension.ps1','repair-production.ps1')) { Copy-Item (Join-Path $source $file) $root -Force }
foreach ($file in @('background.js','content.js','manifest.json','popup.js','popup.html')) { Copy-Item (Join-Path $source $file) $extension -Force }
foreach ($file in @('main_probe.js','stream-events.js','stop-gate.js')) { Remove-Item (Join-Path $extension $file) -Force -ErrorAction SilentlyContinue }
$guardian = Join-Path $root 'guardian.ps1'
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $guardian + '"'
New-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'EditFlowProductionSupervisor' -Value $command -PropertyType String -Force | Out-Null
Start-Process powershell.exe -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $guardian + '"') -WindowStyle Hidden
$ready = $false
for ($i=0; $i -lt 20; $i++) {
  try { $health = Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 1; $ready = $health.version -eq '3.0.1' } catch {}
  if ($ready) { break }; Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Supervisor did not start; backup: ' + $backup }
& (Join-Path $root 'recover-extension.ps1') -Reason 'install-production-supervisor-3'
$loaded = $false
for ($i=0; $i -lt 30; $i++) {
  $health = Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2
  if ($health.extensionVersion -eq '3.0.1') { $loaded = $true; break }; Start-Sleep -Milliseconds 500
}
if (-not $loaded) { throw 'Supervisor running, but browser actuator reload was not confirmed.' }
[pscustomobject]@{version=$health.version; extension=$health.extensionVersion; phase=$health.phase; assignmentId=$health.assignment.assignmentId; startupInstalled=$true; backup=$backup} | ConvertTo-Json
