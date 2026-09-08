param(
  [string]$AfterFxPath = "",
  [Parameter(Mandatory = $true)]
  [string]$AcceptedP1P2Path,
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 90

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. Marker-motion P3/P4 requires the isolated self-hosted AE process." }
  $RunningPaths = @()
  foreach ($Process in $Running) {
    $ProcessPath = $null
    try { $ProcessPath = $Process.Path } catch { $ProcessPath = $null }
    if ($ProcessPath -and (Test-Path $ProcessPath -PathType Leaf)) {
      $ResolvedPath = (Resolve-Path $ProcessPath).Path
      if ($RunningPaths -notcontains $ResolvedPath) { $RunningPaths += $ResolvedPath }
    }
  }
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found at explicit path: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
    if ($RunningPaths -notcontains $ResolvedExplicit) { throw "Explicit AfterFxPath is not the running isolated After Effects executable: $ResolvedExplicit" }
    return $ResolvedExplicit
  }
  if ($RunningPaths.Count -ne 1) { throw "Marker-motion P3/P4 requires exactly one resolvable running After Effects installation." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing." }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted marker-motion P1/P2 result artifact is missing: $AcceptedP1P2Path" }
$AcceptedP1P2Path = (Resolve-Path $AcceptedP1P2Path).Path
$AfterFx = Resolve-RunningAfterFx $AfterFxPath
$VersionInfo = (Get-Item $AfterFx).VersionInfo
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath -PathType Leaf) { Remove-Item $ResultPath -Force }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-marker-motion-p3-p4-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled marker-motion P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 marker/motion/shutter real-AE P3/P4 proof"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Accepted P1/P2 dependency: $AcceptedP1P2Path"
  Write-Host "P3 retains motion-blur, shutter, Frame Mix and Pixel Motion render evidence for independent visual review; artifact existence does not claim visual acceptance."
  Write-Host "P4 injects failure only after independently verified protocol-2.0 writes and requires exact marker/motion/fingerprint rollback."

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--accepted-p1-p2", $AcceptedP1P2Path,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + $CleanupGraceSeconds)
  $ResultSeenAt = $null
  $ForcedAfterResult = $false

  while (-not $NodeProcess.HasExited) {
    $CleanupComplete = $false
    if (Test-Path $ResultPath -PathType Leaf) {
      try {
        $Candidate = Get-Content $ResultPath -Raw | ConvertFrom-Json
        $CleanupComplete = $Candidate.cleanupComplete -eq $true
      } catch { $CleanupComplete = $false }
    }
    if ($CleanupComplete) {
      if ($null -eq $ResultSeenAt) { $ResultSeenAt = Get-Date }
      elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "Marker-motion P3/P4 proof and cleanup completed but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }
    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Marker-motion P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }
    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Marker-motion P3/P4 acceptance exited without a result artifact." }
  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) { $ResultJson | Write-Host; throw "Marker-motion P3/P4 result did not restore the exact disposable-project baseline." }
  if (-not $Result.ok) { $ResultJson | Write-Host; throw "Marker-motion P3/P4 structural/render proof did not pass all bounded checks." }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) { throw "Marker-motion P3/P4 must remain visual-review-required before P3 acceptance." }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) { throw "Marker-motion P3/P4 did not preserve accepted P1/P2 dependency state." }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted -or $Result.proofLevels.P3_visual_proof) { throw "Marker-motion P3 must emit review artifacts without self-asserting visual acceptance." }
  if (-not $Result.proofLevels.P4_failure_injection_rollback) { throw "Marker-motion P4 rollback proof did not pass." }
  if ($Result.proofLevels.P5_save_reopen_reconnect_transfer) { throw "Marker-motion P3/P4 harness must not claim P5." }
  if (-not $Result.checks.p3_motion_off_artifact -or -not $Result.checks.p3_motion_on_artifact -or -not $Result.checks.p3_motion_restored_artifact) { throw "Marker-motion P3 did not emit all required motion-blur contrast renders." }
  if (-not $Result.checks.p3_frame_mix_artifact -or -not $Result.checks.p3_pixel_motion_artifact) { throw "Marker-motion P3 did not emit both frame-blending mode renders." }
  if (-not $Result.checks.p3_nondefault_shutter_structural -or -not $Result.checks.p3_comp_marker_structural -or -not $Result.checks.p3_layer_marker_structural) { throw "Marker-motion P3 structural evidence is incomplete." }
  foreach ($Prefix in @("p4_comp_motion", "p4_layer_motion", "p4_marker_set", "p4_marker_remove")) {
    if (-not $Result.checks.($Prefix + "_induced_failure_reported") -or
        -not $Result.checks.($Prefix + "_fingerprint_restored") -or
        -not $Result.checks.($Prefix + "_structural_state_restored") -or
        -not $Result.checks.($Prefix + "_response_has_restored_readback")) {
      throw "Marker-motion P4 did not prove exact post-write failure rollback for $Prefix."
    }
  }
  if (-not $Result.checks.p4_recovery_visual_artifact_emitted -or -not $Result.checks.p4_cleanup_trigger_restored_baseline) { throw "Marker-motion P4 recovery render/cleanup evidence is incomplete." }
  if (-not $Result.checks.cleanup_fingerprint_restored -or -not $Result.checks.cleanup_blank_unsaved) { throw "Marker-motion P3/P4 cleanup did not restore the exact blank unsaved baseline." }

  Write-Host ("Marker-motion P3/P4 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) { Write-Host "Proof and cleanup completed; wrapper terminated only stuck post-proof Node shutdown." }
} finally {
  Pop-Location
}
