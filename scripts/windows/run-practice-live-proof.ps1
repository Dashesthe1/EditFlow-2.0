param(
  [Parameter(Mandatory=$true)][string]$Finish,
  [Parameter(Mandatory=$true)][string[]]$StartVideo,
  [string[]]$StartAudio = @(),
  [Parameter(Mandatory=$true)][string]$EditTypeId,
  [string]$EditTypeTitle = "",
  [string]$SessionId = "",
  [int]$MaxAttempts = 2,
  [double]$MinimumSimilarity = 0.95,
  [double]$StretchSimilarity = 0.99,
  [double]$ExactSceneConfidence = 0.95,
  [double]$MinimumAudioConfidence = 0.90,
  [int]$TimeoutSeconds = 180,
  [switch]$Allocate,
  [switch]$RequireSubjectIsolationProof,
  [string[]]$RequireIsolationBackend = @(),
  [string[]]$RequireFallbackAfter = @()
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
if ([string]::IsNullOrWhiteSpace($SessionId)) {
  $SessionId = "practice-live-" + (Get-Date -Format "yyyyMMdd-HHmmss")
}
$ArtifactDir = Join-Path $RepoRoot ("proofs\artifacts\practice-live\" + $SessionId)
$ResultPath = Join-Path $ArtifactDir "result.json"
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first."
}
if ($MaxAttempts -lt 1) { throw "MaxAttempts must be at least 1." }
if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Push-Location $RepoRoot
try {
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\practice-live-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) {
    throw "Compiled Practice live CLI not found: $Cli"
  }

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--repository-root", $RepoRoot,
    "--artifact-dir", $ArtifactDir,
    "--result", $ResultPath,
    "--finish", (Resolve-Path -LiteralPath $Finish).Path,
    "--session-id", $SessionId,
    "--edit-type-id", $EditTypeId,
    "--max-attempts", [string]$MaxAttempts,
    "--minimum-similarity", [string]$MinimumSimilarity,
    "--stretch-similarity", [string]$StretchSimilarity,
    "--exact-scene-confidence", [string]$ExactSceneConfidence,
    "--minimum-audio-confidence", [string]$MinimumAudioConfidence,
    "--timeout-ms", [string]($TimeoutSeconds * 1000)
  )
  if (-not [string]::IsNullOrWhiteSpace($EditTypeTitle)) {
    $NodeArgs += @("--edit-type-title", $EditTypeTitle)
  }
  foreach ($video in $StartVideo) {
    $NodeArgs += @("--start-video", (Resolve-Path -LiteralPath $video).Path)
  }
  foreach ($audio in $StartAudio) {
    $NodeArgs += @("--start-audio", (Resolve-Path -LiteralPath $audio).Path)
  }
  if ($Allocate) { $NodeArgs += "--allocate" }
  if ($RequireSubjectIsolationProof) {
    $NodeArgs += "--require-subject-isolation-proof"
  }
  foreach ($backend in $RequireIsolationBackend) {
    if (-not [string]::IsNullOrWhiteSpace($backend)) {
      $NodeArgs += @("--require-isolation-backend", $backend)
    }
  }
  foreach ($backend in $RequireFallbackAfter) {
    if (-not [string]::IsNullOrWhiteSpace($backend)) {
      $NodeArgs += @("--require-fallback-after", $backend)
    }
  }

  Write-Host ("Starting live Practice proof session " + $SessionId)
  & node @NodeArgs
  $ExitCode = $LASTEXITCODE

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "Practice live proof produced no result artifact."
  }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("Practice live proof status: " + $Result.status)
  if ($null -ne $Result.isolationProof) {
    Write-Host ("Subject isolation proof verified: " + $Result.isolationProof.verified)
    if ($Result.isolationProof.reasons.Count -gt 0) {
      foreach ($reason in $Result.isolationProof.reasons) {
        Write-Host ("  isolation: " + $reason)
      }
    }
  }
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ExitCode -ne 0) { exit $ExitCode }
} finally {
  Pop-Location
}