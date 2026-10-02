param([string]$Reason = 'gateway_unavailable')
$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $env:LOCALAPPDATA 'EditFlow2\current-runtime.json') -Raw | ConvertFrom-Json
$repo = $manifest.repositoryRoot
$script = Join-Path $repo 'scripts\current-shadow-control-daemon.mjs'
$log = Join-Path $PSScriptRoot 'production-recovery.log'
Add-Content $log ((Get-Date).ToString('o') + ' recovery ' + $Reason)
$existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*scripts/current-shadow-control-daemon.mjs*' })
$healthy = $false
try { $healthy = (Invoke-RestMethod ($manifest.productBaseUrl + '/healthz') -TimeoutSec 3).ok } catch {}
if ($healthy -and $Reason -eq 'gateway_unavailable') { return }
# The supervisor marks ambiguous jobs RECONCILE_REQUIRED before deadline recovery.
# Restart only our gateway; never stop AE, Chrome, or unrelated Node processes.
foreach ($process in $existing) { Stop-Process -Id $process.ProcessId -Force }
Start-Process (Get-Command node.exe).Source -ArgumentList ('"' + $script + '"') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'gateway-recovery.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'gateway-recovery.stderr.log')
