param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-motion-render-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$AcceptedP1P2Path = Join-Path $RepoRoot "proofs\diagnostics\m3-motion-render-p1-p2-acceptance.json"
$CleanupGraceSeconds = 90

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. The motion-render P3/P4 wrapper requires the isolated self-hosted AE process." }
  $RunningPaths = @()
  foreach ($Process in $Running) {
    $ProcessPath = $null
    try { $ProcessPath = $Process.Path } catch { $ProcessPath = $null }
    if ($ProcessPath -and (Test-Path $ProcessPath -PathType Leaf)) {
      $Resolved = (Resolve-Path $ProcessPath).Path
      if ($RunningPaths -notcontains $Resolved) { $RunningPaths += $Resolved }
    }
  }
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
    if ($RunningPaths -notcontains $ResolvedExplicit) { throw "Explicit AfterFxPath is not the already-running isolated AE executable." }
    return $ResolvedExplicit
  }
  if ($RunningPaths.Count -ne 1) { throw "Motion-render P3/P4 requires exactly one resolvable After Effects installation/process." }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP config is missing; install the isolated protocol 1.10 preview first." }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted protocol 1.10 P1/P2 record is missing: $AcceptedP1P2Path" }
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-motion-render-p3-p4-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled motion-render P3/P4 CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 protocol 1.10 motion-render real-AE P3 candidate + P4 rollback proof"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "P3 emits retained motion-blur and frame-blending render families for independent visual review; this wrapper does not accept P3."
  Write-Host "P4 injects failures only after verified protocol-1.10 comp/layer writes and requires exact structural/fingerprint restoration."

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
  while (-not $NodeProcess.HasExited) {
    $CleanupComplete = $false
    if (Test-Path $ResultPath -PathType Leaf) {
      try { $CleanupComplete = (Get-Content $ResultPath -Raw | ConvertFrom-Json).cleanupComplete -eq $true } catch { $CleanupComplete = $false }
    }
    if ($CleanupComplete) {
      if ($null -eq $ResultSeenAt) { $ResultSeenAt = Get-Date }
      elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "Motion-render P3/P4 proof and cleanup completed but Node did not exit; terminating only the completed proof runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        break
      }
    }
    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Motion-render P3/P4 acceptance exceeded its hard runtime before cleanup completion."
    }
    Start-Sleep -Milliseconds 250
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Motion-render P3/P4 exited without result artifact." }
  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) { $ResultJson | Write-Host; throw "Motion-render P3/P4 result did not complete cleanup." }
  if (-not $Result.ok) { $ResultJson | Write-Host; throw "Motion-render P3/P4 bounded structural/artifact proof failed." }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) { throw "P3/P4 result lost accepted P1/P2 lineage." }
  if ($Result.proofLevels.P3_visual_proof -ne $false) { throw "P3 must remain false until independent visual review accepts retained renders." }
  if ($Result.proofLevels.P4_failure_injection_rollback -ne $true) { throw "P4 rollback was not truthfully proven." }
  if ($Result.proofLevels.P5_save_reopen_reconnect_transfer -ne $false) { throw "P3/P4 wrapper must not claim P5." }
  if ($Result.visualReviewRequired -ne $true) { throw "P3/P4 result must require independent visual review." }
  foreach ($Key in @(
    "p3_motion_structural_enabled",
    "p3_motion_restored_structural",
    "p3_frame_mix_structural",
    "p3_pixel_motion_structural",
    "p3_blend_restored_structural",
    "p3_visual_artifacts_emitted",
    "p4_comp_induced_failure",
    "p4_comp_fingerprint_restored",
    "p4_comp_state_restored",
    "p4_layer_induced_failure",
    "p4_layer_fingerprint_restored",
    "p4_layer_state_restored",
    "p4_structural_rollback_complete",
    "cleanup_fingerprint_restored"
  )) {
    if ($Result.checks.$Key -ne $true) { throw "Motion-render P3/P4 check '$Key' was not true." }
  }
  Write-Host ("Motion-render P3 candidate/P4 status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
} finally {
  Pop-Location
}
