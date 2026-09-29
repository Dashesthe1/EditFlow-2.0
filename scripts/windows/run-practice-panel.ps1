param(
  [string]$ArtifactDir = "",
  [string]$StateDir = "",
  [string]$FfmpegPath = "",
  [int]$TimeoutMs = 180000,
  [switch]$SkipBuild
)

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
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP config not found. Run scripts\windows\install-editflow-cep.ps1 first."
}
$BridgeConfig = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$ControlPort = [int]$BridgeConfig.port + 1
$Base = "http://127.0.0.1:$ControlPort"
$Headers = @{ "X-EditFlow-Token" = [string]$BridgeConfig.token }

function Get-LocalStatus([string]$Uri) {
  try { return Invoke-RestMethod -Uri $Uri -Method Get -Headers $Headers -TimeoutSec 2 }
  catch { return $null }
}
$ProductStatus = Get-LocalStatus "$Base/v1/product/status"
$ControlStatus = Get-LocalStatus "$Base/status"
$ExpectedWorkflow = "ACCELERATED_REFERENCE_FIRST_V1"
if ($ProductStatus.practiceWorkflow -eq $ExpectedWorkflow -and
    $ProductStatus.practiceStartup -eq "RESUMABLE_PREFLIGHT_V1" -and
    $ControlStatus.repoRoot -eq $RepoRoot) {
  Write-Host "Accelerated Practice is already primary in the live Shadow control plane."
  Write-Host "Practice endpoint: $Base/v1/product/status"
  exit 0
}

if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    npm run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "Practice runtime build failed." }
  } finally { Pop-Location }
}

$DaemonPath = Join-Path $RepoRoot "scripts\current-shadow-control-daemon.mjs"
if (-not (Test-Path $DaemonPath -PathType Leaf)) {
  throw "Unified Practice daemon not found: $DaemonPath"
}
$Listener = Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($null -ne $Listener) {
  if ($ControlStatus.service -ne "EditFlow Current Shadow Control") {
    throw "Port $ControlPort belongs to an unknown service; no process was stopped."
  }
  if ($ControlStatus.mutationLease.held -eq $true) {
    throw "The AE control daemon has an active mutation lease; wait for that work before switching Practice."
  }
  if ($ProductStatus.activeRunId) {
    throw "A Practice assignment is active; resume it or safely pause before switching worktrees."
  }
  $OwnerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($Listener.OwningProcess)"
  if ($null -eq $OwnerProcess -or
      $OwnerProcess.CommandLine -notmatch 'current-shadow-control-daemon[.]mjs') {
    throw "Port $ControlPort is not owned by the expected EditFlow daemon; no process was stopped."
  }
  Write-Host "Switching the EditFlow control daemon to the accelerated Practice build. AE stays open."
  Stop-Process -Id $Listener.OwningProcess -ErrorAction Stop
  for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue) {
    throw "Old EditFlow control daemon did not release port $ControlPort."
  }
}
if ($ArtifactDir) { $env:EDITFLOW_PRACTICE_ARTIFACT_DIR = [System.IO.Path]::GetFullPath($ArtifactDir) }
if ($StateDir) { $env:EDITFLOW_PRACTICE_STATE_DIR = [System.IO.Path]::GetFullPath($StateDir) }
if ($FfmpegPath) { $env:EDITFLOW_FFMPEG_PATH = (Resolve-Path $FfmpegPath).Path }
$env:EDITFLOW_PRACTICE_TIMEOUT_MS = [string]$TimeoutMs
Write-Host "Starting unified EditFlow control and accelerated Practice service."
Write-Host "Keep this window open. Press Ctrl+C to stop the service; AE remains open."
& node $DaemonPath
if ($LASTEXITCODE -ne 0) {
  throw "Unified Practice service exited with code $LASTEXITCODE."
}
