$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogRoot = Join-Path $Root ".tmp\current-shadow"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Test-Listening([int]$Port) {
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-Http([string]$Uri, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $value = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 2
      if ($value.ok) { return $value }
    } catch {}
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Uri"
}

$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$Tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
$GatewayPython = Join-Path $env:USERPROFILE "editgpt\.venv\Scripts\python.exe"
if (-not (Test-Path $GatewayPython)) {
  $GatewayPython = (Get-Command python.exe -ErrorAction Stop).Source
}
$PublicPathFile = Join-Path $LogRoot "public-path.txt"
$PublicPath = [string]$env:EDITFLOW_SHADOW_PUBLIC_PATH
if ([string]::IsNullOrWhiteSpace($PublicPath) -and (Test-Path $PublicPathFile)) {
  $PublicPath = (Get-Content -Raw $PublicPathFile).Trim()
}
if ([string]::IsNullOrWhiteSpace($PublicPath)) {
  throw "Set EDITFLOW_SHADOW_PUBLIC_PATH or create $PublicPathFile before exposing the Shadow MCP tunnel."
}
if (-not $PublicPath.StartsWith("/")) {
  throw "EDITFLOW_SHADOW_PUBLIC_PATH must begin with '/'."
}

if ([string]::IsNullOrWhiteSpace($env:EDITFLOW_SHADOW_ALLOWED_HOSTS)) {
  try {
    $ts = (& $Tailscale status --json | ConvertFrom-Json)
    $dnsName = [string]$ts.Self.DNSName
    if (-not [string]::IsNullOrWhiteSpace($dnsName)) {
      $env:EDITFLOW_SHADOW_ALLOWED_HOSTS = $dnsName.TrimEnd('.')
    }
  } catch {}
}

$Compiled = Join-Path $Root ".tmp\runtime\apps\desktop-host\src\loopback-cep.js"
if (-not (Test-Path $Compiled)) {
  Push-Location $Root
  try { & $Npm run build:test-runtime } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Listening 32146)) {
  if (Test-Listening 32145) {
    throw "CEP broker port 32145 is already owned by another process; refusing to replace a live broker blindly."
  }
  Start-Process -FilePath $Node `
    -ArgumentList @((Join-Path $Root "scripts\current-shadow-control-daemon.mjs")) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput (Join-Path $LogRoot "control.out.log") `
    -RedirectStandardError (Join-Path $LogRoot "control.err.log") | Out-Null
}
$health = Wait-Http "http://127.0.0.1:32146/healthz" 20

if (-not (Test-Listening 8770)) {
  Start-Process -FilePath $GatewayPython `
    -ArgumentList @((Join-Path $Root "scripts\current_shadow_gateway_v3.py"),"--host","127.0.0.1","--port","8770") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput (Join-Path $LogRoot "gateway.out.log") `
    -RedirectStandardError (Join-Path $LogRoot "gateway.err.log") | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Listening 8770) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Listening 8770)) { throw "Current Shadow MCP gateway did not start on 8770." }
}

& $Tailscale funnel --bg --yes --set-path=$PublicPath "http://127.0.0.1:8770/mcp" | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "EditFlow Current Shadow path is ready."
Write-Host ("Execution mode: " + $health.executionMode)
Write-Host ("AE host revision: " + $health.hostRevision)
