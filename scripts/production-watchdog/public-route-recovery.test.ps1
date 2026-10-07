$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'public-route-recovery.ps1')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$script:commands = @()
$script:offExit = 0
$script:changeConfig = $false
$script:config = @{Web=@{'isolated.ts.net:443'=@{Handlers=@{'/retained'=@{Proxy='http://127.0.0.1:8770/mcp'};'/other'=@{Proxy='http://127.0.0.1:9999'}}}};AllowFunnel=@{'isolated.ts.net:443'=$true}}
function Invoke-TailscaleRecoveryCommand([string[]]$Arguments) {
  $script:commands += ,$Arguments
  if ($Arguments[0] -eq 'serve') {
    $value = $script:config | ConvertTo-Json -Depth 100 -Compress
    if ($script:changeConfig -and $script:commands.Count -gt 1) { $value = $value.Replace('9999','9998') }
    return @{exitCode=0;output=$value}
  }
  return @{exitCode=$(if ($Arguments[-1] -eq 'off') {$script:offExit} else {0});output=''}
}
Invoke-ExistingPublicRouteRefresh 'isolated.ts.net' '/retained'
Assert ($script:commands.Count -eq 4) 'Expected one off/on with before/after reads'
Assert (($script:commands[1] -join '|') -eq 'funnel|--bg|--https=443|--set-path=/retained|off') 'Off altered route'
Assert (($script:commands[2] -join '|') -eq 'funnel|--bg|--https=443|--set-path=/retained|http://127.0.0.1:8770/mcp') 'Restore altered mapping'
$script:commands = @(); $script:offExit = 1
try { Invoke-ExistingPublicRouteRefresh 'isolated.ts.net' '/retained'; throw 'FAILED_TO_REJECT_OFF' }
catch { Assert ($_.Exception.Message -eq 'EXISTING_PUBLIC_ROUTE_REFRESH_FAILED') 'Wrong off failure' }
Assert ($script:commands.Count -eq 3 -and $script:commands[-1][-1] -eq 'http://127.0.0.1:8770/mcp') 'Failed off did not restore'
foreach ($invalid in @('/','/missing')) {
  $script:commands = @()
  try { Invoke-ExistingPublicRouteRefresh 'isolated.ts.net' $invalid; throw 'FAILED_TO_REJECT_ROUTE' }
  catch { Assert ($_.Exception.Message -in @('PUBLIC_ROUTE_CONFIG_INVALID','EXISTING_PUBLIC_ROUTE_REQUIRED')) 'Wrong validation failure' }
  Assert (@($script:commands | Where-Object { $_[0] -eq 'funnel' }).Count -eq 0) 'Invalid route was changed'
}
$script:commands = @(); $script:offExit = 0; $script:changeConfig = $true
try { Invoke-ExistingPublicRouteRefresh 'isolated.ts.net' '/retained'; throw 'FAILED_TO_REJECT_CONFIG_CHANGE' }
catch { Assert ($_.Exception.Message -eq 'PUBLIC_ROUTE_CONFIGURATION_CHANGED') 'Unrelated route change ignored' }
foreach ($errorCode in @('HTTP_401','MCP_PROTOCOL_REJECTED','PUBLIC_DNS_PRIVATE_ADDRESS')) {
  Assert (-not (Test-RecoverablePublicTransportFailure @{local=@{ready=$true};routeConfigured=$true;public=@{ready=$false;error=$errorCode}})) 'Protocol failure triggered route refresh'
}
Assert (Test-RecoverablePublicTransportFailure @{local=@{ready=$true};routeConfigured=$true;public=@{ready=$false;error='CONNECTION_TIMEOUT'}}) 'Real public timeout ignored'
Assert (-not (Test-RecoverablePublicTransportFailure @{local=@{ready=$false};routeConfigured=$true;public=@{ready=$false;error='CONNECTION_TIMEOUT'}})) 'Local outage triggered public refresh'
Write-Output 'PUBLIC_ROUTE_RECOVERY_TESTS_PASSED'
