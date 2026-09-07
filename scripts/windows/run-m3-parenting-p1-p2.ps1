param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-parenting-p1-p2"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The M3 parenting P1/P2 wrapper requires the isolated self-hosted AE process to be running first."
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
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded M3 parenting proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-parenting-p1-p2-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 parenting P1/P2 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 parenting real-AE P1/P2 proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Scope: P1 deterministic rejection and P2 exact structural/no-jump geometry readback only. P3/P4/P5 are not claimed."
  Write-Host "The proof uses a non-identity transformed parent so direct Layer.parent compensation is exercised rather than trivially passing."
  Write-Host "The proof creates only temporary compositions/layers and restores the exact baseline project fingerprint before completion."

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
        Write-Warning "M3 parenting P1/P2 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M3 parenting P1/P2 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M3 parenting P1/P2 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M3 parenting P1/P2 result was produced without successful temporary-project cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M3 parenting P1/P2 real-AE proof did not pass all bounded checks."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "M3 parenting result did not truthfully assert both P1 and P2."
  }
  if ($Result.proofLevels.P3_visual_proof -or $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "M3 parenting P1/P2 harness must not claim P3, P4, or P5."
  }
  if (-not $Result.checks.p2_set_parent_local_transform_compensated) {
    throw "M3 parenting proof did not show local-transform compensation under the transformed parent."
  }
  if (-not $Result.checks.p2_set_parent_comp_space_preserved -or -not $Result.checks.p2_clear_parent_comp_space_preserved) {
    throw "M3 parenting proof did not preserve the child comp-space anchor through set/clear parenting."
  }
  if (-not $Result.checks.cleanup_fingerprint_restored) {
    throw "M3 parenting proof did not restore the exact pre-proof project fingerprint."
  }

  Write-Host ("M3 parenting P1/P2 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
