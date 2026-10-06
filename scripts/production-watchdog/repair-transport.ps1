param([string]$Reason = 'mcp_transport_unavailable', [string]$AssignmentId = '')
$ErrorActionPreference = 'Stop'
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\EditFlowMcpTransportRecovery', [ref]$created)
if (-not $created) { @{ready=$false;status='RECOVERY_IN_PROGRESS'} | ConvertTo-Json -Compress; exit 0 }
function Test-RecoverablePublicTransportFailure($probe) {
  if (-not $probe.local.ready -or -not $probe.routeConfigured) { return $false }
  $networkErrors = @('CONNECTION_FAILED','CONNECTION_RESET','CONNECTION_TIMEOUT')
  if ($probe.public.error -in $networkErrors) { return $true }
  $relayErrors = @($probe.public.relayErrors)
  return $probe.public.error -eq 'PUBLIC_RELAY_PARTIAL' -and $relayErrors.Count -gt 0 -and @($relayErrors | Where-Object { $_ -notin $networkErrors }).Count -eq 0
}
try {
  $root = Join-Path $env:LOCALAPPDATA 'EditFlow2'
  if ($AssignmentId) {
    $health = Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 3
    if ($health.authority.assignmentId -ne $AssignmentId) { throw 'RECOVERY_ASSIGNMENT_CHANGED' }
  }
  $manifest = Get-Content (Join-Path $root 'current-runtime.json') -Raw | ConvertFrom-Json
  $repo = [string]$manifest.repositoryRoot
  $script = Join-Path $repo 'scripts\current_shadow_gateway_v3.py'
  $node = (Get-Command node.exe).Source
  $probeScript = Join-Path $repo 'scripts\production-watchdog\transport-health.js'
  $probe = & $node $probeScript | ConvertFrom-Json
  if ($probe.ready) { $probe | ConvertTo-Json -Depth 5 -Compress; exit 0 }
  $ts = & tailscale.exe status --json | ConvertFrom-Json
  $hostName = ([string]$ts.Self.DNSName).TrimEnd('.')
  if ($hostName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') { throw 'PUBLIC_HOST_CONFIG_INVALID' }
  if (-not $probe.local.ready) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8770 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
      # An existing canonical gateway may still be starting after boot. Do not launch a duplicate.
      $starting = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($script) }
      if ($starting) {
        $startupDeadline = (Get-Date).AddSeconds(10)
        while (-not $listener -and (Get-Date) -lt $startupDeadline) {
          Start-Sleep -Milliseconds 250
          $listener = Get-NetTCPConnection -State Listen -LocalPort 8770 -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if (-not $listener) { throw 'MCP_STARTUP_NOT_READY' }
        $probe = & $node $probeScript | ConvertFrom-Json
      }
    }
    if (-not $probe.local.ready) {
      if ($listener) {
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $listener.OwningProcess)
        if ($process.Name -ne 'python.exe' -or -not $process.CommandLine.Contains($script)) { throw 'MCP_PORT_OWNER_UNEXPECTED' }
        Stop-Process -Id $process.ProcessId
      }
      $env:EDITFLOW_SHADOW_ALLOWED_HOSTS = $hostName
      $python = Join-Path $env:USERPROFILE 'editgpt\.venv\Scripts\python.exe'
      if (-not (Test-Path $python)) { throw 'MCP_ENVIRONMENT_MISSING' }
      Start-Process $python -ArgumentList @(('"' + $script + '"'),'--host','127.0.0.1','--port','8770') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'mcp-recovery.stdout.log') -RedirectStandardError (Join-Path $root 'mcp-recovery.stderr.log')
      $deadline = (Get-Date).AddSeconds(10)
      while (-not (Get-NetTCPConnection -State Listen -LocalPort 8770 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    }
  }
  if ($ts.BackendState -eq 'Running' -and $ts.Self.Online -and $probe.public.error -eq 'PUBLIC_ROUTE_NOT_CONFIGURED') {
    # Restore only the already-saved protected path and its existing public exposure.
    # Never create a new path, change authentication or broaden connection permissions.
    $publicPath = (Get-Content (Join-Path $root 'public-path.txt') -Raw).Trim()
    if ($publicPath -notmatch '^/[A-Za-z0-9/_-]+$' -or $publicPath -eq '/') { throw 'PUBLIC_ROUTE_CONFIG_INVALID' }
    $null = & tailscale.exe funnel --bg --https=443 --set-path=$publicPath 'http://127.0.0.1:8770/mcp' 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'EXISTING_PUBLIC_ROUTE_RESTORE_FAILED' }
  }
  # Read-only protocol checks; no tools/call, worker claim, production write or AE action.
  $after = & $node $probeScript | ConvertFrom-Json
  if (Test-RecoverablePublicTransportFailure $after) {
    # Refresh existing network sockets once; keep the saved route, keys and policy intact.
    $null = & tailscale.exe debug rebind 2>&1
    if ($LASTEXITCODE -eq 0) { $after = & $node $probeScript | ConvertFrom-Json }
  }
  if (Test-RecoverablePublicTransportFailure $after) {
    # Reconnect the existing relays once if socket rebind left a public relay unreachable.
    $null = & tailscale.exe debug break-derp-conns 2>&1
    if ($LASTEXITCODE -eq 0) { $after = & $node $probeScript | ConvertFrom-Json }
  }
  Add-Content (Join-Path $root 'mcp-recovery.log') ((Get-Date).ToString('o') + ' reason=' + $Reason + ' ready=' + $after.ready)
  $after | ConvertTo-Json -Depth 6 -Compress
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
