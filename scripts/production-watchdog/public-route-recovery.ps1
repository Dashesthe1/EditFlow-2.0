function Test-RecoverablePublicTransportFailure($probe) {
  if (-not $probe.local.ready -or -not $probe.routeConfigured -or $probe.public.ready) { return $false }
  $networkErrors = @('CONNECTION_FAILED','CONNECTION_RESET','CONNECTION_TIMEOUT')
  if ($probe.public.error -in $networkErrors) { return $true }
  $relayErrors = @($probe.public.relayErrors)
  return $probe.public.error -eq 'PUBLIC_RELAY_PARTIAL' -and $relayErrors.Count -gt 0 -and @($relayErrors | Where-Object { $_ -notin $networkErrors }).Count -eq 0
}

function Invoke-TailscaleRecoveryCommand([string[]]$Arguments) {
  $output = & $script:TailscalePath @Arguments 2>&1
  return @{exitCode=$LASTEXITCODE; output=($output -join "`n")}
}

function Invoke-ExistingPublicRouteRefresh([string]$HostName, [string]$PublicPath) {
  if ($HostName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$' -or $PublicPath -notmatch '^/[A-Za-z0-9/_-]+$' -or $PublicPath -eq '/') { throw 'PUBLIC_ROUTE_CONFIG_INVALID' }
  $before = Invoke-TailscaleRecoveryCommand -Arguments @('serve','status','--json')
  if ($before.exitCode -ne 0) { throw 'PUBLIC_ROUTE_READ_FAILED' }
  $config = $before.output | ConvertFrom-Json
  $key = $HostName + ':443'
  $proxy = 'http://127.0.0.1:8770/mcp'
  if ($config.Web.$key.Handlers.$PublicPath.Proxy -ne $proxy -or $config.AllowFunnel.$key -ne $true) { throw 'EXISTING_PUBLIC_ROUTE_REQUIRED' }
  try {
    $off = Invoke-TailscaleRecoveryCommand -Arguments @('funnel','--bg','--https=443',('--set-path=' + $PublicPath),'off')
    if ($off.exitCode -ne 0) { throw 'EXISTING_PUBLIC_ROUTE_REFRESH_FAILED' }
  } finally {
    # Even a failed off acknowledgment must restore this exact existing mapping.
    $on = Invoke-TailscaleRecoveryCommand -Arguments @('funnel','--bg','--https=443',('--set-path=' + $PublicPath),$proxy)
    if ($on.exitCode -ne 0) { throw 'EXISTING_PUBLIC_ROUTE_RESTORE_FAILED' }
  }
  $after = Invoke-TailscaleRecoveryCommand -Arguments @('serve','status','--json')
  if ($after.exitCode -ne 0) { throw 'PUBLIC_ROUTE_READ_FAILED' }
  $restored = $after.output | ConvertFrom-Json
  if (($config | ConvertTo-Json -Depth 100 -Compress) -ne ($restored | ConvertTo-Json -Depth 100 -Compress)) { throw 'PUBLIC_ROUTE_CONFIGURATION_CHANGED' }
}
