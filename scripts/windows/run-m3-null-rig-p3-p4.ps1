param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-null-rig-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. The null-rig P3/P4 wrapper requires the isolated self-hosted AE process to be running first." }

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
    if ($RunningPaths -notcontains $ResolvedExplicit) { throw "The explicit AfterFxPath is not an already running After Effects executable: $ResolvedExplicit." }
    return $ResolvedExplicit
  }
  if ($RunningPaths.Count -eq 0) { throw "After Effects is running, but its executable path could not be resolved." }
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded null-rig proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first." }
if ($env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ne "1") {
  throw "Null-rig P3/P4 acceptance requires the runner-owned AE process to inherit EDITFLOW_M3_NULL_RIG_P4_PROOF=1."
}

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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-null-rig-p3-p4-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 null-rig P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 null-rig real-AE P3 visual-artifact + P4 rollback proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Scope: P3 invisible true-null controller drives a visible child, detach preserves the driven frame; P4 injects failure after managed-null creation and requires exact AE-Undo recovery."
  Write-Host "P3 is deliberately not self-accepted: retained render evidence must be independently reviewed before VISUAL maturity is advanced."
  Write-Host "P5 save/reopen/reconnect transfer is not claimed by this tranche."

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
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
        Write-Warning "Null-rig P3/P4 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Null-rig P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "Null-rig P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "Null-rig P3/P4 result was produced without successful proof-owned cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "Null-rig P3/P4 real-AE proof did not pass its bounded geometry/recovery checks."
  }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) {
    throw "Null-rig P3/P4 result must remain VISUAL_REVIEW_REQUIRED until retained render evidence is independently reviewed."
  }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted) { throw "Null-rig P3/P4 result did not emit all required P3 visual artifacts." }
  if ($Result.proofLevels.P3_visual_proof) { throw "Null-rig P3/P4 harness must not self-claim P3 visual acceptance." }
  if (-not $Result.proofLevels.P4_failure_injection_rollback) { throw "Null-rig P3/P4 result did not truthfully assert P4 induced-failure rollback." }
  if ($Result.proofLevels.P5_save_reopen_reconnect_transfer) { throw "Null-rig P3/P4 harness must not claim P5 transfer." }
  if (-not $Result.checks.p3_rig_drive_geometry_moved -or -not $Result.checks.p3_detach_no_jump) {
    throw "Null-rig P3 result did not show material controller-driven geometry plus no-jump detach."
  }
  if (-not $Result.checks.p4_fingerprint_restored -or -not $Result.checks.p4_item_count_restored -or -not $Result.checks.p4_failed_rig_absent) {
    throw "Null-rig P4 result did not restore the exact pre-failure project state."
  }
  if (-not $Result.checks.cleanup_fingerprint_restored -or -not $Result.checks.cleanup_item_count_restored) {
    throw "Null-rig P3/P4 proof did not restore the exact original blank baseline."
  }

  Write-Host ("Null-rig P3/P4 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  Write-Host ("P3 neutral render: " + $Result.visualReviewSpec.attachedNeutralRender)
  Write-Host ("P3 driven render: " + $Result.visualReviewSpec.rigDrivenRender)
  Write-Host ("P3 detached render: " + $Result.visualReviewSpec.detachedPreservedRender)
  Write-Host ("P4 post-rollback render: " + $Result.visualReviewSpec.postRollbackRender)
  if ($ForcedAfterResult) { Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown." }
} finally {
  Pop-Location
}
