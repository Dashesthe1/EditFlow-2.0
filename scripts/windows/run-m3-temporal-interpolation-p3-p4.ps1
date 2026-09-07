param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-interpolation-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 90

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. The temporal P3/P4 wrapper requires the isolated self-hosted AE process first." }
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
    if ($RunningPaths -notcontains $ResolvedExplicit) { throw "Explicit AfterFxPath is not the already-running isolated After Effects executable: $ResolvedExplicit" }
    return $ResolvedExplicit
  }
  if ($RunningPaths.Count -eq 0) { throw "After Effects is running but its executable path could not be resolved." }
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded temporal proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first." }
$AfterFx = Resolve-RunningAfterFx $AfterFxPath
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-interpolation-p3-p4-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled temporal P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 temporal-interpolation real-AE P3/P4 proof"
  Write-Host "Running After Effects: $AfterFx"
  Write-Host "P3 emits retained LINEAR / incoming-HOLD / outgoing-HOLD / restored-LINEAR visual artifacts for independent review."
  Write-Host "P4 induces failure only after a verified protocol-1.7 interpolation mutation and requires exact AE Undo restoration."
  Write-Host "P5 is not claimed. Graph Editor ease/influence and spatial interpolation remain out of scope."

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
        Write-Warning "Temporal P3/P4 proof and cleanup completed but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }
    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Temporal P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }
    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Temporal P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))." }
  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "Temporal P3/P4 result was produced without exact baseline cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "Temporal P3/P4 real-AE harness did not pass its bounded structural/rollback checks."
  }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) {
    throw "Temporal P3/P4 harness must stop at VISUAL_REVIEW_REQUIRED until retained renders are independently reviewed."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "Temporal P3/P4 result did not preserve accepted P1/P2 baseline truth."
  }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted -or $Result.proofLevels.P3_visual_proof) {
    throw "Temporal P3 harness must emit visual evidence without self-accepting P3."
  }
  if (-not $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "Temporal P3/P4 harness must prove P4 while leaving P5 false."
  }
  if (-not $Result.checks.p3_linear_artifact -or -not $Result.checks.p3_incoming_hold_artifact -or -not $Result.checks.p3_outgoing_hold_artifact -or -not $Result.checks.p3_restored_linear_artifact) {
    throw "Temporal P3 did not retain all required visual comparison artifacts."
  }
  if (-not $Result.checks.p4_induced_failure_reported -or -not $Result.checks.p4_response_readback_restored -or -not $Result.checks.p4_fingerprint_restored -or -not $Result.checks.p4_structural_state_restored) {
    throw "Temporal P4 did not prove exact injected-failure rollback."
  }
  if (-not $Result.checks.p4_recovery_visual_artifact_emitted) { throw "Temporal P4 did not retain post-rollback visual evidence." }
  if (-not $Result.checks.cleanup_temp_items_absent -or -not $Result.checks.cleanup_item_count_restored -or -not $Result.checks.cleanup_fingerprint_restored) {
    throw "Temporal P3/P4 proof did not restore the exact isolated project baseline."
  }

  Write-Host ("M3 temporal-interpolation P3/P4 harness status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) { Write-Host "Proof and cleanup completed successfully; wrapper terminated only the stuck post-proof Node shutdown." }
} finally {
  Pop-Location
}
