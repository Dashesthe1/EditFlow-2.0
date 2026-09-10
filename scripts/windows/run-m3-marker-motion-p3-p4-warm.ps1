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
$NodeLogPath = Join-Path $ArtifactDir "proof-node.log"
$WrapperErrorPath = Join-Path $ArtifactDir "wrapper-error.txt"
$Stage = "preflight"
$ExitCode = 0
$LocationPushed = $false

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath -PathType Leaf) { Remove-Item $ResultPath -Force }
if (Test-Path $NodeLogPath -PathType Leaf) { Remove-Item $NodeLogPath -Force }
if (Test-Path $WrapperErrorPath -PathType Leaf) { Remove-Item $WrapperErrorPath -Force }

try {
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

  Push-Location $RepoRoot
  $LocationPushed = $true

  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    $Stage = "npm_install"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }

  $Stage = "build_test_runtime"
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot "scripts\m3-marker-motion-p3-p4-fast.mjs"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Fast marker-motion P3/P4 CLI not found: $Cli" }

  # Execute only the static, manifest-declared EditFlow panel opener in the already-running AE instance.
  $Stage = "open_editflow_panel"
  $PanelArguments = '-r "' + $PanelOpenerPath + '"'
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList $PanelArguments -WindowStyle Hidden -PassThru)
  Start-Sleep -Milliseconds 500

  # BOOTSTRAP launches inherit this gate from the workflow. REUSE_AE retains that process environment.
  $Stage = "run_node_proof"
  $env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF = "1"
  try {
    & node $Cli --config $ConfigPath --result $ResultPath --accepted-p1-p2 $AcceptedP1P2Path --timeout-ms ($TimeoutSeconds * 1000) *> $NodeLogPath
    $NodeExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF -ErrorAction SilentlyContinue
  }

  if ($NodeExit -ne 0 -and (Test-Path $NodeLogPath -PathType Leaf)) {
    Write-Host "--- marker-motion node diagnostic tail ---"
    Get-Content $NodeLogPath -Tail 80 | Write-Host
    Write-Host "--- end marker-motion node diagnostic tail ---"
  }

  $Stage = "validate_result"
  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Marker-motion P3/P4 exited without result.json." }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  if ($NodeExit -ne 0) {
    Get-Content $ResultPath -Raw | Write-Host
    $ExitCode = $NodeExit
  } else {
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
  }
} catch {
  $Message = "Marker-motion warm wrapper failed at stage '$Stage': $($_.Exception.Message)"
  ($Message + [Environment]::NewLine + ($_ | Out-String)) | Out-File -FilePath $WrapperErrorPath -Encoding utf8

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    $NodeTail = if (Test-Path $NodeLogPath -PathType Leaf) { (@(Get-Content $NodeLogPath -Tail 40) -join [Environment]::NewLine) } else { $null }
    $Fallback = [ordered]@{
      proofId = "M3_MARKER_MOTION_P3_P4_REAL_AE"
      classification = "PRODUCT_FAILURE"
      status = "FAILURE"
      ok = $false
      message = $Message
      lifecycle = $env:EDITFLOW_AE_LIFECYCLE
      mutationStarted = $false
      cleanupComplete = $true
      wrapperStage = $Stage
      diagnosticLog = if ($NodeTail) { "proof-node.log" } else { "wrapper-error.txt" }
      nodeDiagnosticTail = $NodeTail
    }
    $Fallback | ConvertTo-Json -Depth 6 | Out-File -FilePath $ResultPath -Encoding utf8
  }

  Write-Error $Message
  $ExitCode = 1
} finally {
  Remove-Item Env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF -ErrorAction SilentlyContinue
  if ($LocationPushed) { Pop-Location }
}

if ($ExitCode -ne 0) { exit $ExitCode }
