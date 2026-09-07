param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-mask-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The M3 P3/P4 wrapper requires the isolated self-hosted AE process to be running first."
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

  if ($RunningPaths.Count -eq 0) {
    throw "After Effects is running, but its executable path could not be resolved."
  }
  if ($RunningPaths.Count -gt 1) {
    throw "Multiple After Effects installations are running; the bounded M3 proof requires exactly one isolated target."
  }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
}
if ($env:EDITFLOW_M3_MASK_P4_PROOF -ne "1") {
  throw "M3 P3/P4 acceptance requires the self-hosted runner-owned AE process to inherit EDITFLOW_M3_MASK_P4_PROOF=1."
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-mask-p3-p4-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 mask P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 mask/Bezier real-AE P3 visual-artifact + P4 rollback proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Scope: P3 deterministic mask-driven compositing render and P4 induced post-mutation failure/AE-Undo recovery."
  Write-Host "P3 is deliberately not self-accepted: retained render evidence must be visually reviewed before P3 maturity is advanced."
  Write-Host "P5 save/reopen/reconnect transfer is not claimed by this tranche."
  Write-Host "The proof creates only temporary imported bitmaps plus one temporary comp/layers/mask; after the terminal post-rollback render, a proof-gated host wrapper verifies that exact unsaved fixture before discarding it and creating a fresh blank project, which the harness must re-observe at the original structural fingerprint."

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
        Write-Warning "M3 P3/P4 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M3 mask P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M3 mask P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M3 P3/P4 result was produced without successful temporary-project cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M3 mask P3/P4 real-AE proof did not pass its bounded structural/recovery checks."
  }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) {
    throw "M3 P3/P4 result must remain VISUAL_REVIEW_REQUIRED until retained render evidence is independently reviewed."
  }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted) {
    throw "M3 P3/P4 result did not emit the required P3 visual artifact."
  }
  if ($Result.proofLevels.P3_visual_proof) {
    throw "M3 P3/P4 harness must not self-claim P3 visual acceptance before independent artifact review."
  }
  if (-not $Result.proofLevels.P4_failure_injection_rollback) {
    throw "M3 P3/P4 result did not truthfully assert P4 induced-failure rollback."
  }
  if ($Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "M3 P3/P4 harness must not claim P5 transfer."
  }

  Write-Host ("M3 mask P3/P4 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  Write-Host ("P3 render: " + $Result.visualReviewSpec.render)
  Write-Host ("P4 post-rollback render: " + $Result.visualReviewSpec.postRollbackRender)
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
