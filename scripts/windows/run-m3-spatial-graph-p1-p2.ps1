param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-spatial-graph-p1-p2"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The M3 spatial-graph P1/P2 wrapper requires the isolated self-hosted AE process to be running first."
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
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded M3 spatial-graph proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. The spatial-graph self-hosted runner must install its isolated protocol 1.9 preview first."
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-spatial-graph-p1-p2-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 spatial-graph P1/P2 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 spatial Graph Editor real-AE P1/P2 proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Scope: P1 deterministic rejection/no mutation and P2 exact 2D/3D spatial structural readback only. P3/P4/P5 are not claimed."
  Write-Host "Protocol 1.9 owns spatial tangents, continuity, Auto-Bezier and roving; accepted protocol 1.5 creates only disposable 2D/3D null fixtures; protocol 1.1 creates keyframes/comp fixtures."
  Write-Host "Auto-Bezier tangents are host-owned: the proof requires finite dimensional readback and stable no-op state, not equality to caller-supplied tangent vectors."
  Write-Host "The proof creates only temporary project objects and restores the exact baseline project fingerprint before completion."

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
      } catch {
        $CleanupComplete = $false
      }
    }

    if ($CleanupComplete) {
      if ($null -eq $ResultSeenAt) {
        $ResultSeenAt = Get-Date
      } elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "M3 spatial-graph P1/P2 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M3 spatial-graph P1/P2 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M3 spatial-graph P1/P2 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M3 spatial-graph P1/P2 result was produced without successful temporary-project cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M3 spatial-graph P1/P2 real-AE proof did not pass all bounded checks."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "M3 spatial-graph result did not truthfully assert both P1 and P2."
  }
  if ($Result.proofLevels.P3_visual_proof -or $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "M3 spatial-graph P1/P2 harness must not claim P3, P4, or P5."
  }
  if (-not $Result.checks.p1_non_spatial_rejected -or -not $Result.checks.p1_bad_2d_dimension_rejected -or -not $Result.checks.p1_roving_endpoint_rejected) {
    throw "M3 spatial-graph P1 did not prove required property, dimensionality, and endpoint-roving rejection."
  }
  if (-not $Result.checks.p1_auto_manual_tangent_forbidden_rejected -or -not $Result.checks.p1_stale_revision_rejected) {
    throw "M3 spatial-graph P1 did not prove Auto-Bezier/manual-tangent exclusivity and stale-revision rejection."
  }
  if (-not $Result.checks.p2_2d_manual_readback_exact -or -not $Result.checks.p2_3d_manual_readback_exact) {
    throw "M3 spatial-graph P2 did not prove exact 2D and 3D manual tangent readback."
  }
  if (-not $Result.checks.p2_interior_roving_readback -or -not $Result.checks.p2_interior_roving_reset) {
    throw "M3 spatial-graph P2 did not prove interior roving state and deterministic reset."
  }
  if (-not $Result.checks.p2_auto_3d_readback_host_shaped -or -not $Result.checks.p2_auto_3d_host_tangents_stable_on_noop) {
    throw "M3 spatial-graph P2 did not prove host-owned 3D Auto-Bezier readback and idempotent stability."
  }
  if (-not $Result.checks.p2_2d_manual_no_op_revision_unchanged -or -not $Result.checks.p2_3d_manual_no_op_revision_unchanged -or -not $Result.checks.p2_auto_3d_no_op_revision_unchanged) {
    throw "M3 spatial-graph P2 did not prove no-op revision stability."
  }
  if (-not $Result.checks.cleanup_fingerprint_restored) {
    throw "M3 spatial-graph proof did not restore the exact pre-proof project fingerprint."
  }

  Write-Host ("M3 spatial-graph P1/P2 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
