$ErrorActionPreference = 'SilentlyContinue'
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\EditFlowPracticeChatSupervisorGuardian', [ref]$createdNew)
if (-not $createdNew) { exit 0 }
$node = (Get-Command node.exe).Source
$script = Join-Path $PSScriptRoot 'supervisor.js'
try {
  while ($true) {
    $healthy = $false
    try { $healthy = (Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2).ok } catch {}
    if (-not $healthy) {
      $existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $script + '*') })
      if ($existing.Count -eq 0) { Start-Process $node -ArgumentList ('"' + $script + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden }
    }
    Start-Sleep -Seconds 5
  }
} finally { try { $mutex.ReleaseMutex() } catch {}; $mutex.Dispose() }
