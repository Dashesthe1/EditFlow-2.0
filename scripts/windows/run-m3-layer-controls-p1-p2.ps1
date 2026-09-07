param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-layer-controls-p1-p2"
$ResultPath = Join-Path $ArtifactDir "result.json"
$SetupScript = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_layer_controls_p12_fixture.jsx"
$CleanupScript = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_layer_controls_p12_cleanup.jsx"
$CleanupGraceSeconds = 60

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. The M3 layer-controls P1/P2 wrapper requires the isolated self-hosted AE process to be running first."
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
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded M3 layer-controls proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

function Quote-StartProcessArgument {
  param([string]$Value)

  if ($null -eq $Value) { return '""' }
  if ($Value.Contains('"')) { throw "Node proof argument contains an unsupported quote character." }
  return '"' + $Value + '"'
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if ($env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF -ne "1") { throw "Layer-controls P1/P2 wrapper requires EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF=1 before After Effects is launched." }
if (-not $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX -or -not $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX.StartsWith("M3_LAYER_CONTROLS_P12_")) {
  throw "Layer-controls P1/P2 wrapper requires a fixed runner-generated proof prefix before After Effects is launched."
}
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first." }
if (-not (Test-Path $SetupScript -PathType Leaf)) { throw "Layer-controls P1/P2 fixture script is missing: $SetupScript" }
if (-not (Test-Path $CleanupScript -PathType Leaf)) { throw "Layer-controls P1/P2 cleanup script is missing: $CleanupScript" }

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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-layer-controls-p1-p2-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M3 layer-controls P1/P2 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M3 layer switches/quality controls real-AE P1/P2 proof"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Scope: P1 deterministic legality/stale/lock rejection and P2 exact switch/quality/master-shy readback only. P3/P4/P5 are not claimed."
  Write-Host "Protocol 1.6 owns layer-control mutations/readback. Accepted protocol 1.1 is used only for host observation/fingerprinting."
  Write-Host "Proof-only fixed JSX creates and later discards the isolated audio/precomp/solid/camera fixture; it adds no production command."

  # Start-Process joins ArgumentList entries into a native command line. Quote every
  # filesystem value explicitly so paths such as C:\Program Files\... remain one
  # Node argv entry instead of being truncated to C:\Program.
  $NodeArgs = @(
    (Quote-StartProcessArgument $Cli),
    "--config", (Quote-StartProcessArgument $ConfigPath),
    "--result", (Quote-StartProcessArgument $ResultPath),
    "--afterfx-path", (Quote-StartProcessArgument $AfterFx),
    "--setup-script", (Quote-StartProcessArgument $SetupScript),
    "--cleanup-script", (Quote-StartProcessArgument $CleanupScript),
    "--timeout-ms", [string]($TimeoutSeconds * 1000)
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
        Write-Warning "M3 layer-controls P1/P2 proof and cleanup are complete but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M3 layer-controls P1/P2 acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M3 layer-controls P1/P2 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M3 layer-controls P1/P2 result was produced without successful proof-owned cleanup."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M3 layer-controls P1/P2 real-AE proof did not pass all bounded checks."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "M3 layer-controls result did not truthfully assert both P1 and P2."
  }
  if ($Result.proofLevels.P3_visual_proof -or $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "M3 layer-controls P1/P2 harness must not claim P3, P4, or P5."
  }

  $RequiredChecks = @(
    "p1_unknown_control_rejected",
    "p1_av_only_camera_rejected",
    "p1_no_audio_rejected",
    "p1_unsettable_collapse_rejected",
    "p1_locked_conflict_rejected",
    "p1_stale_revision_rejected",
    "p2_audio_disable_exact",
    "p2_audio_enable_exact",
    "p2_quality_draft_bicubic",
    "p2_quality_wireframe_bilinear",
    "p2_quality_best",
    "p2_collapse_exact",
    "p2_unlock_first_exact",
    "p2_lock_last_exact",
    "p2_comp_hide_shy_on",
    "p2_comp_hide_shy_off",
    "p2_order_preserved",
    "cleanup_fingerprint_restored"
  )
  foreach ($Check in $RequiredChecks) {
    if ($Result.checks.$Check -ne $true) { throw "M3 layer-controls proof is missing required check: $Check" }
  }

  Write-Host ("M3 layer-controls P1/P2 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) { Write-Host "Proof and cleanup completed successfully; wrapper terminated only the stuck post-proof Node shutdown." }
} finally {
  Pop-Location
}
