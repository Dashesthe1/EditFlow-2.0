param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$PanelOpenerPath = Join-Path $RepoRoot "scripts\windows\open-editflow2-panel.jsx"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { $ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p3-p4" }
$ResultPath = Join-Path $ArtifactDir "result.json"
$AcceptedP1P2Path = Join-Path $RepoRoot ".accepted\m3-marker-motion-p1-p2\result.json"

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if ($env:EDITFLOW_AE_WARM_SESSION -ne "1") { throw "Marker-motion P3/P4 must run through the accelerated AE lifecycle orchestrator." }
if ($env:EDITFLOW_AE_LIFECYCLE -notin @("REUSE_AE", "RESTART_AE")) { throw "Marker-motion P3/P4 supports only REUSE_AE or an explicit one-time RESTART_AE preview bootstrap." }
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe not found: $AfterFxPath" }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing." }
if (-not (Test-Path $PanelOpenerPath -PathType Leaf)) { throw "Bounded EditFlow panel opener is missing: $PanelOpenerPath" }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted marker-motion P1/P2 result is missing: $AcceptedP1P2Path" }

$Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($Running.Count -eq 0) { throw "Accelerated orchestrator did not leave a running After Effects process for the proof." }
$ResolvedExpected = (Resolve-Path $AfterFxPath).Path
$Matching = @()
foreach ($Process in $Running) {
  try {
    $Candidate = (Resolve-Path $Process.Path).Path
    $Process.Refresh()
    if ([StringComparer]::OrdinalIgnoreCase.Equals($Candidate, $ResolvedExpected) -and $Process.Responding) { $Matching += $Process }
  } catch {}
}
if ($Matching.Count -ne 1) { throw "Marker-motion P3/P4 requires exactly one healthy target After Effects process; found $($Matching.Count)." }

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

  $Cli = Join-Path $RepoRoot "scripts\m3-marker-motion-p3-p4-fast.mjs"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Fast marker-motion P3/P4 CLI not found: $Cli" }

  # Adobe's supported -r route executes this static JSX in the already-running AE
  # instance. The JSX resolves only the exact EditFlow menu label from the manifest;
  # it does not inspect/click/focus arbitrary windows and does not use keyboard input.
  $PanelArguments = '-r "' + $PanelOpenerPath + '"'
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList $PanelArguments -WindowStyle Hidden -PassThru)
  Start-Sleep -Milliseconds 500

  # This also keeps direct/manual runs compatible. For a BOOTSTRAP run the workflow
  # sets the same variable before the lifecycle orchestrator launches After Effects,
  # so the new AE process inherits the proof gate. REUSE_AE then retains that warm
  # process environment without another process restart.
  $env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF = "1"
  try {
    & node $Cli --config $ConfigPath --result $ResultPath --accepted-p1-p2 $AcceptedP1P2Path --timeout-ms ($TimeoutSeconds * 1000)
    $NodeExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Marker-motion P3/P4 exited without result.json." }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  if ($NodeExit -ne 0) {
    Get-Content $ResultPath -Raw | Write-Host
    exit $NodeExit
  }
  if ($Result.classification -ne "PASS" -or $Result.ok -ne $true) { throw "Marker-motion P3/P4 did not classify PASS." }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) { throw "P3/P4 must remain visual-review-required before P3 acceptance." }
  if ($Result.proofLevels.P3_visual_artifact_emitted -ne $true -or $Result.proofLevels.P3_visual_proof -ne $false) { throw "P3 artifacts must be emitted without self-asserting visual acceptance." }
  if ($Result.proofLevels.P4_failure_injection_rollback -ne $true) { throw "P4 rollback proof did not pass." }
  foreach ($Surface in @("comp_motion_set", "layer_motion_set", "marker_set", "marker_remove")) {
    if ($Result.p4Matrix.$Surface.ok -ne $true) { throw "P4 rollback matrix did not pass for $Surface." }
  }
  if ($Result.proofLevels.P5_save_reopen_reconnect_transfer -ne $false) { throw "P3/P4 harness must not claim P5." }
  if ($Result.cleanupComplete -ne $true) { throw "P3/P4 did not restore the exact warm-project baseline." }

  Write-Host "Marker-motion fast P3/P4 structural/rollback proof passed."
  Write-Host "P4 passed composition motion, layer motion, marker set, and marker remove rollback." 
  Write-Host "Measured proof elapsed ms: $($Result.elapsedMs); 30-second target met: $($Result.speedTargetMet)"
  Write-Host "P3 viewer-visible artifacts were emitted and still require independent visual acceptance."
  Write-Host "Warm After Effects process was not closed by this proof wrapper."
} finally {
  Remove-Item Env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF -ErrorAction SilentlyContinue
  Pop-Location
}