param(
  [string]$AfterFxPath = "",
  [string]$AcceptedP1P2Path = "",
  [int]$TimeoutSeconds = 240
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
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The M3 marker-motion P3/P4 wrapper requires the isolated self-hosted AE process to be running first."
  }

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
    if ($RunningPaths -notcontains $ResolvedExplicit) {
      throw "The explicit AfterFxPath is not an already running After Effects executable: $ResolvedExplicit."
    }
    return $ResolvedExplicit
  }

  if ($RunningPaths.Count -eq 0) { throw "After Effects is running, but its executable path could not be resolved." }
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded M3 marker-motion P3/P4 proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
}
if (-not $AcceptedP1P2Path) {
  $AcceptedP1P2Path = Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p1-p2\result.json"
}
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) {
  throw "Accepted marker-motion P1/P2 artifact is missing: $AcceptedP1P2Path"
}
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
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 marker-motion P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 marker-motion real-AE P3/P4 proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Accepted P1/P2 artifact: $AcceptedP1P2Path"
  Write-Host "P3 fixture A: AE-animated footage layer with no blur, 30-degree shutter blur, 360-degree shutter blur, and restored baseline renders."
  Write-Host "P3 fixture B: deliberately retimed numbered BMP footage sequence rendered once with Frame Mix and once with Pixel Motion, plus restored baseline."
  Write-Host "Marker evidence remains structural/timeline evidence. P3 does not self-promote from file existence; retained renders require independent decoded review."
  Write-Host "P4 uses a proof-gated post-verification composition-motion failure and requires both exact protocol-2.0 readback restoration and unchanged structural project fingerprint."

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
      } catch {
        $CleanupComplete = $false
      }
    }

    if ($CleanupComplete) {
      if ($null -eq $ResultSeenAt) {
        $ResultSeenAt = Get-Date
      } elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "M3 marker-motion P3/P4 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M3 marker-motion P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M3 marker-motion P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M3 marker-motion P3/P4 result was produced without successful temporary-project cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M3 marker-motion P3/P4 real-AE proof did not pass all bounded structural/artifact checks."
  }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) {
    throw "M3 marker-motion P3/P4 result must remain VISUAL_REVIEW_REQUIRED until retained renders receive independent decoded review."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "M3 marker-motion P3/P4 result did not truthfully carry accepted P1/P2 forward."
  }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted -or $Result.proofLevels.P3_visual_proof) {
    throw "M3 marker-motion P3/P4 result must retain P3 media while leaving P3_visual_proof false."
  }
  if (-not $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "M3 marker-motion P3/P4 result must prove P4 and must not claim P5."
  }
  if (-not $Result.checks.p3_comp_marker_structural -or -not $Result.checks.p3_layer_marker_structural) {
    throw "M3 marker-motion P3/P4 proof did not retain exact composition/layer marker timeline evidence."
  }
  if (-not $Result.checks.p3_motion_no_blur_artifact -or -not $Result.checks.p3_motion_narrow_artifact -or -not $Result.checks.p3_motion_wide_artifact -or -not $Result.checks.p3_motion_restored_artifact) {
    throw "M3 marker-motion P3/P4 proof did not retain the complete motion-blur/shutter render set."
  }
  if (-not $Result.checks.p3_frame_mix_artifact -or -not $Result.checks.p3_pixel_motion_artifact -or -not $Result.checks.p3_frame_blend_restored_artifact) {
    throw "M3 marker-motion P3/P4 proof did not retain the complete frame-blending render set."
  }
  if (-not $Result.checks.p4_induced_failure_reported -or -not $Result.checks.p4_rollback_note -or -not $Result.checks.p4_response_readback_restored) {
    throw "M3 marker-motion P4 did not prove the exact proof-gated failure/transaction-rollback response contract."
  }
  if (-not $Result.checks.p4_fingerprint_restored -or -not $Result.checks.p4_structural_state_restored -or -not $Result.checks.p4_recovery_visual_artifact_emitted) {
    throw "M3 marker-motion P4 did not restore both structural fingerprint and exact protocol-2.0 state with recovery media."
  }
  if (-not $Result.checks.cleanup_fingerprint_restored -or -not $Result.checks.cleanup_temp_items_absent) {
    throw "M3 marker-motion P3/P4 proof did not return to the exact pre-proof project baseline."
  }

  Write-Host ("M3 marker-motion P3/P4 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  Write-Host "Retained renders are evidence candidates only; decoded pixel screening/review is the next acceptance action for P3."
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
