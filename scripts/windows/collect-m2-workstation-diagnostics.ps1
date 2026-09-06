param()

$ErrorActionPreference = "Continue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-workstation-live"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ExtensionRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

function Read-JsonFileSafe {
  param([string]$Path)
  if (-not (Test-Path $Path -PathType Leaf)) { return $null }
  try { return (Get-Content $Path -Raw | ConvertFrom-Json) } catch { return [ordered]@{ parse_error = $_.Exception.Message; path = $Path } }
}

function Hash-IfPresent {
  param([string]$Path)
  if (-not (Test-Path $Path -PathType Leaf)) { return $null }
  try { return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant() } catch { return $null }
}

$Processes = @()
foreach ($Process in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
  $Path = $null
  try { $Path = $Process.Path } catch {}
  $Processes += [ordered]@{
    id = $Process.Id
    path = $Path
    title = $Process.MainWindowTitle
    responding = $Process.Responding
  }
}

$Config = $null
if (Test-Path $ConfigPath -PathType Leaf) {
  try {
    $RawConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $Config = [ordered]@{
      schemaVersion = $RawConfig.schemaVersion
      host = $RawConfig.host
      port = $RawConfig.port
      token = "<redacted>"
      protocolVersion = $RawConfig.protocolVersion
      extensionId = $RawConfig.extensionId
      extensionVersion = $RawConfig.extensionVersion
    }
  } catch {
    $Config = [ordered]@{ parse_error = $_.Exception.Message; token = "<redacted>" }
  }
}

$KnownFiles = @(
  "client\bridge.js",
  "host\editflow_host_current.jsx",
  "host\editflow_host_render_jobs.jsx",
  "host\editflow_host_atomicity.jsx",
  "host\editflow_host_hardening.jsx"
)
$InstalledHashes = [ordered]@{}
foreach ($Relative in $KnownFiles) {
  $InstalledHashes[$Relative] = Hash-IfPresent (Join-Path $ExtensionRoot $Relative)
}

$SmokeResultPath = Join-Path $RepoRoot "proofs\artifacts\m2-cep-smoke\result.json"
$AcceptanceResultPath = Join-Path $RepoRoot "proofs\artifacts\m2-real-host\result.json"
$RenderLifecyclePath = Join-Path $RepoRoot "proofs\artifacts\m2-real-host\m2-proof.avi.editflow-render.json"

$Diagnostics = [ordered]@{
  schemaVersion = 1
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  github = [ordered]@{
    sha = $env:GITHUB_SHA
    ref = $env:GITHUB_REF
    runId = $env:GITHUB_RUN_ID
    runAttempt = $env:GITHUB_RUN_ATTEMPT
  }
  afterEffectsProcesses = $Processes
  bridgeConfig = $Config
  installedExtensionHashes = $InstalledHashes
  smokeResult = Read-JsonFileSafe $SmokeResultPath
  acceptanceResult = Read-JsonFileSafe $AcceptanceResultPath
  renderLifecycle = Read-JsonFileSafe $RenderLifecyclePath
}

$Diagnostics | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $ArtifactDir "diagnostics.json") -Encoding utf8
Write-Host "M2 workstation diagnostics collected with authentication token redacted."
