param(
  [string]$ArtifactDir = "",
  [string]$StateDir = "",
  [string]$FfmpegPath = "",
  [int]$TimeoutMs = 180000,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"

if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP config not found. Run scripts\windows\install-editflow-cep.ps1 first."
}
if (-not $ArtifactDir) {
  $ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\practice-product"
}
if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    npm run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "Practice runtime build failed." }
  } finally {
    Pop-Location
  }
}

$CliPath = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\practice-panel-cli.js"
if (-not (Test-Path $CliPath -PathType Leaf)) {
  throw "Compiled Practice panel service not found: $CliPath"
}

$Arguments = @(
  $CliPath,
  "--config", $ConfigPath,
  "--repository-root", $RepoRoot,
  "--artifact-dir", $ArtifactDir,
  "--timeout-ms", [string]$TimeoutMs
)
if (-not [string]::IsNullOrWhiteSpace($StateDir)) {
  $Arguments += @("--state-dir", [System.IO.Path]::GetFullPath($StateDir))
}
if ($FfmpegPath) {
  $Arguments += @("--ffmpeg", (Resolve-Path $FfmpegPath).Path)
}

Write-Host "Starting EditFlow Practice service. Keep this window open while using the panel."
Write-Host "Press Ctrl+C to stop."
& node @Arguments
if ($LASTEXITCODE -ne 0) {
  throw "Practice service exited with code $LASTEXITCODE."
}
