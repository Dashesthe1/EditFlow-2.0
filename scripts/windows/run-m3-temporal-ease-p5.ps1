param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p5-transfer"
$ResultPath = Join-Path $ArtifactDir "result.json"
$ReopenScript = Join-Path $RepoRoot "scripts\windows\m3-temporal-ease-p5-reopen.jsx"
$CleanupScript = Join-Path $RepoRoot "scripts\windows\m3-temporal-ease-p5-cleanup.jsx"
$AcceptedP1P4 = Join-Path $RepoRoot "proofs\diagnostics\m3-temporal-ease-p1-p4-acceptance.json"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The temporal-ease P5 wrapper requires the isolated self-hosted AE process to be running first."
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
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded temporal-ease P5 proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

function Quote-StartProcessArgument {
  param([string]$Value)
  if ($null -eq $Value) { return '""' }
  if ($Value.Contains('"')) { throw "Temporal-ease P5 Start-Process arguments must not contain literal quote characters." }
  return '"' + $Value + '"'
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if ($env:EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF -ne "1") {
  throw "Temporal-ease P5 requires the runner-owned AE process to inherit EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF=1."
}
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
}
if (-not (Test-Path $ReopenScript -PathType Leaf)) { throw "Temporal-ease P5 reopen script is missing: $ReopenScript" }
if (-not (Test-Path $CleanupScript -PathType Leaf)) { throw "Temporal-ease P5 cleanup script is missing: $CleanupScript" }
if (-not (Test-Path $AcceptedP1P4 -PathType Leaf)) {
  throw "Temporal-ease P5 refuses to run until the retained P1-P4 acceptance record exists: $AcceptedP1P4"
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-ease-p5-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 temporal-ease P5 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 temporal-ease real-AE P5 save/reopen/reconnect transfer proof"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Prerequisite: committed P1-P4 acceptance record with independently reviewed P3 visual proof."
  Write-Host "Scope: scalar Opacity ease -> project.save -> fixed .aep reopen -> protocol-1.8 dispatcher reload -> distinct authenticated CEP session -> exact saved readback -> fresh two-component Scale ease write/readback -> proof-only cleanup."
  Write-Host "P1-P4 are not replayed by this tranche."

  $NodeArgs = @(
    (Quote-StartProcessArgument $Cli),
    "--config", (Quote-StartProcessArgument $ConfigPath),
    "--result", (Quote-StartProcessArgument $ResultPath),
    "--afterfx-path", (Quote-StartProcessArgument $AfterFx),
    "--reopen-script", (Quote-StartProcessArgument $ReopenScript),
    "--cleanup-script", (Quote-StartProcessArgument $CleanupScript),
    "--accepted-p1-p4", (Quote-StartProcessArgument $AcceptedP1P4),
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds(($TimeoutSeconds * 3) + $CleanupGraceSeconds)
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
        Write-Warning "Temporal-ease P5 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Temporal-ease P5 exceeded its hard runtime before proof/cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "Temporal-ease P5 exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "Temporal-ease P5 result was produced without successful proof-owned project cleanup."
  }
  if (-not $Result.ok -or $Result.status -ne "PASS") {
    $ResultJson | Write-Host
    throw "Temporal-ease P5 real-AE transfer proof did not pass."
  }
  if (-not $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "Temporal-ease P5 result did not truthfully assert save/reopen/reconnect transfer."
  }
  if (-not $Result.checks.authenticated_reconnect) {
    throw "Temporal-ease P5 did not prove a distinct authenticated CEP session after reopen."
  }
  if (-not $Result.checks.opacity_ease_exact_after_reopen_reconnect) {
    throw "Temporal-ease P5 did not prove exact saved scalar ease across reopen/reconnect."
  }
  if (-not $Result.checks.post_reconnect_scale_mutation_readback) {
    throw "Temporal-ease P5 did not prove fresh-session two-component Scale write/readback authority."
  }
  if (-not $Result.checks.saved_project_retained_after_cleanup) {
    throw "Temporal-ease P5 did not retain the saved .aep proof artifact after cleanup."
  }

  Write-Host "M3 temporal-ease P5 transfer proof: PASS (capability promotion still requires evidence review/commit)"
  Write-Host ("Result artifact: " + $ResultPath)
  Write-Host ("Saved project artifact: " + $Result.artifacts.savedProject)
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
