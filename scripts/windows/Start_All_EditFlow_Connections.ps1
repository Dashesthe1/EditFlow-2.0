param([switch]$LocalOnly)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$CanonicalPath = Join-Path $env:LOCALAPPDATA "EditFlow2\current-runtime.json"
if (Test-Path $CanonicalPath -PathType Leaf) {
  $Canonical = Get-Content -Raw $CanonicalPath | ConvertFrom-Json
  if ($Canonical.schema -eq "editflow.current-runtime.v1" -and
      (Test-Path (Join-Path $Canonical.repositoryRoot "scripts\current-shadow-control-daemon.mjs"))) {
    $RepoRoot = [string]$Canonical.repositoryRoot
  }
}
$CoreLauncher = Join-Path $RepoRoot "scripts\windows\Start_Current_EditFlow_Shadow.ps1"

function Test-Listening([int]$Port) {
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Pass([string]$Name, [string]$Detail = "") {
  Write-Host ("[PASS] {0} {1}" -f $Name, $Detail)
}

function Get-DesktopCommanderRemote {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match "desktop-commander" -and
    $_.CommandLine -match "(^|\s)remote(\s|$)"
  })
}

Write-Host ""
Write-Host "=== EditFlow / ChatGPT / After Effects Connections ==="

$ReaderRepair = Join-Path $RepoRoot "scripts\windows\repair-desktop-commander-read-handles.mjs"
if (Test-Path $ReaderRepair) {
  & (Get-Command node.exe -ErrorAction Stop).Source $ReaderRepair
  if ($LASTEXITCODE -ne 0) { throw "Desktop Commander text-reader repair failed." }
}
$dcRemote = Get-DesktopCommanderRemote
if ($dcRemote.Count -eq 0) {
  $npx = Get-Command npx.cmd -ErrorAction Stop
  Write-Host "[INFO] Starting Desktop Commander Remote..."
  Start-Process -FilePath $npx.Source -ArgumentList @("@wonderwhy-er/desktop-commander@latest", "remote") -WindowStyle Minimized | Out-Null

  $dcDeadline = (Get-Date).AddSeconds(12)
  do {
    Start-Sleep -Milliseconds 500
    $dcRemote = Get-DesktopCommanderRemote
  } while ($dcRemote.Count -eq 0 -and (Get-Date) -lt $dcDeadline)

  if ($dcRemote.Count -eq 0) {
    throw "Desktop Commander Remote did not start. Run: npx.cmd @wonderwhy-er/desktop-commander@latest remote"
  }
  Pass "Desktop Commander Remote" ("started; PID " + $dcRemote[0].ProcessId)
} else {
  Pass "Desktop Commander Remote" ("already running; PID " + $dcRemote[0].ProcessId)
}

$ae = @(Get-Process -Name AfterFX -ErrorAction SilentlyContinue)
if ($ae.Count -ne 1) {
  throw "Exactly one After Effects instance must already be open. Open AE from the taskbar, then rerun this command. This launcher will never close or restart AE."
}
if (-not $ae[0].Responding) {
  throw "After Effects is running but not responding. This launcher will not kill or restart it."
}
Pass "After Effects" ("PID " + $ae[0].Id + "; preserved")

if (-not (Test-Path $CoreLauncher -PathType Leaf)) {
  throw "Missing core launcher: $CoreLauncher"
}
Write-Host "[INFO] Restoring or reusing the EditFlow control plane..."
$coreArgs = @{}
if ($LocalOnly) { $coreArgs["LocalOnly"] = $true }
& $CoreLauncher @coreArgs
if ($LASTEXITCODE -ne 0) {
  throw "Core EditFlow launcher exited with code $LASTEXITCODE."
}

foreach ($port in @(32145, 32146, 8770)) {
  if (-not (Test-Listening $port)) {
    throw "Required EditFlow port $port is not listening."
  }
}
Pass "CEP broker" "127.0.0.1:32145"
Pass "AE control server" "127.0.0.1:32146"
Pass "MCP gateway" "127.0.0.1:8770"

$health = Invoke-RestMethod -Uri "http://127.0.0.1:32146/healthz" -Method Get -TimeoutSec 4
if (-not $health.ok) {
  throw "EditFlow health endpoint did not return ok=true."
}
if (-not $health.panel -or [string]::IsNullOrWhiteSpace([string]$health.panel.sessionId)) {
  throw "The control server is running, but the EditFlow CEP panel is not attached to After Effects."
}
Pass "AE <-> CEP session" ("session " + [string]$health.panel.sessionId)

$cep = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "CEPHtmlEngine.exe" -and $_.CommandLine -match "com\.editflow2\.bridge"
})
if ($cep.Count -eq 0) {
  throw "EditFlow CEPHtmlEngine process was not detected after bootstrap."
}
Pass "EditFlow CEP panel" ("PID " + $cep[0].ProcessId)
if (-not $LocalOnly) {
  $tailscale = Get-Command tailscale.exe -ErrorAction Stop
  $ts = (& $tailscale.Source status --json | ConvertFrom-Json)
  if ($ts.BackendState -ne "Running") {
    throw "Tailscale is not connected. Open/sign in to Tailscale, then rerun this command."
  }
  Pass "Tailscale" ([string]$ts.Self.DNSName)

  $publicPathFile = Join-Path $env:LOCALAPPDATA "EditFlow2\public-path.txt"
  $publicPath = if (Test-Path $publicPathFile) { (Get-Content -Raw $publicPathFile).Trim() } else { "" }
  $funnel = (& $tailscale.Source funnel status 2>&1 | Out-String)
  if ([string]::IsNullOrWhiteSpace($publicPath) -or $funnel -notmatch [regex]::Escape($publicPath)) {
    throw "Tailscale Funnel did not verify the configured EditFlow MCP path."
  }
  Pass "Public MCP tunnel" $publicPath
} else {
  Write-Host "[SKIP] Public MCP tunnel (LocalOnly)"
}

Write-Host ""
Write-Host "READY: ChatGPT -> EditFlow MCP -> CEP -> After Effects"
Write-Host ("Execution mode: " + [string]$health.executionMode)
Write-Host ("AE host revision: " + [string]$health.hostRevision)
Write-Host "Production supervisor uses the current ChatGPT-directed workflow and retained assignment state."
Write-Host "After Effects was not stopped or restarted."
Write-Host ""
exit 0
