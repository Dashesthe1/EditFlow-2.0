$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$supervisorRoot = Join-Path $env:LOCALAPPDATA 'EditFlow2\chat-supervisor'
$extensionRoot = Join-Path $env:USERPROFILE 'Downloads\chatgpt_phrase_monitor_chrome'
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
$backupRoot = Join-Path $supervisorRoot ('backup-liveness-' + $stamp)
$orchestration = Join-Path $env:LOCALAPPDATA 'EditFlow2\practice-state\gpt-orchestration.json'
$hashBefore = (Get-FileHash $orchestration -Algorithm SHA256).Hash
New-Item $backupRoot -ItemType Directory -Force | Out-Null
New-Item (Join-Path $backupRoot 'extension') -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $supervisorRoot 'supervisor.js') $backupRoot
Copy-Item (Join-Path $supervisorRoot 'state.json') $backupRoot
Copy-Item (Join-Path $supervisorRoot 'liveness.js') $backupRoot
Copy-Item (Join-Path $supervisorRoot 'stop-gate.js') $backupRoot
Copy-Item (Join-Path $supervisorRoot 'recover-extension.ps1') $backupRoot
$extensionFiles = @('background.js','content.js','main_probe.js','stream-events.js','stop-gate.js','manifest.json','popup.js','popup.html','README.md')
foreach ($name in $extensionFiles) {
  $existing = Join-Path $extensionRoot $name
  if (Test-Path $existing) { Copy-Item $existing (Join-Path $backupRoot 'extension') }
}
Copy-Item (Join-Path $sourceRoot 'supervisor.js') $supervisorRoot
Copy-Item (Join-Path $sourceRoot 'liveness.js') $supervisorRoot
Copy-Item (Join-Path $sourceRoot 'stop-gate.js') $supervisorRoot
Copy-Item (Join-Path $sourceRoot 'recover-extension.ps1') $supervisorRoot
foreach ($name in $extensionFiles) { Copy-Item (Join-Path $sourceRoot $name) $extensionRoot }
$liveScript = Join-Path $supervisorRoot 'supervisor.js'
$oldProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $liveScript + '*')
}
foreach ($p in $oldProcesses) { Stop-Process -Id $p.ProcessId -Force }
# The guardian may restart it first. Start it only if the port remains down.
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  try { $health = Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 1; $ready = $health.version -eq '1.7.2' } catch {}
  if ($ready) { break }
  if ($i -eq 5) {
    Start-Process (Get-Command node.exe).Source -ArgumentList ('"' + $liveScript + '"') -WorkingDirectory $supervisorRoot -WindowStyle Hidden
  }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'New supervisor did not become healthy; backup is available at the reported path.' }
# This deployment explicitly resumes the armed assignment. Chat-scope checks
# keep maintenance conversations excluded; subsequent manual controls persist.
Invoke-RestMethod 'http://127.0.0.1:32147/monitor/resume' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 2 | Out-Null
& (Join-Path $supervisorRoot 'recover-extension.ps1') -Reason 'upgrade-watchdog-2.6.2-continuous-recovery'
$extensionReady = $false
for ($i = 0; $i -lt 15; $i++) {
  $health = Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2
  if ($health.extensionVersion -eq '2.6.2' -and $health.heartbeatAgeMs -lt 10000) { $extensionReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $extensionReady) { throw 'Supervisor upgraded, but the current extension heartbeat was not verified.' }
[pscustomobject]@{
  supervisorVersion = $health.version
  extensionVersion = $health.extensionVersion
  supervisorPid = $health.pid
  assignmentId = $health.practice.assignmentId
  sessionId = $health.practice.sessionId
  assignmentPreserved = ((Get-FileHash $orchestration -Algorithm SHA256).Hash -eq $hashBefore)
  backupPath = $backupRoot
} | ConvertTo-Json
