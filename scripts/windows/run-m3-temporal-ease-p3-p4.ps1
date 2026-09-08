param(
  [string]$AfterFxPath = "",
  [Parameter(Mandatory = $true)]
  [string]$AcceptedP1P2Path,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$BaselinePath = Join-Path $ArtifactDir "cleanup-baseline.json"
$CleanupVerifyPath = Join-Path $ArtifactDir "cleanup-verify.json"
$CleanupMarkerPath = Join-Path $ArtifactDir "cleanup-result.json"
$CleanupScript = Join-Path $RepoRoot "scripts\windows\m3-temporal-ease-p3-p4-cleanup.jsx"
$CleanupGraceSeconds = 90

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. The temporal-ease P3/P4 wrapper requires the isolated self-hosted AE process first." }
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
  if ($RunningPaths.Count -gt 1) { throw "Multiple After Effects installations are running; the bounded temporal-ease proof requires exactly one isolated target." }
  return $RunningPaths[0]
}

function Write-JsonUtf8NoBom {
  param([string]$Path, [object]$Value)
  $Json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, $Json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-BaselineProbe {
  param(
    [string]$Cli,
    [string]$Output,
    [string]$Expected = ""
  )
  $Args = @($Cli, "--config", $ConfigPath, "--output", $Output)
  if ($Expected) { $Args += @("--expected", $Expected) }
  & node @Args
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $Output -PathType Leaf) { Get-Content $Output -Raw | Write-Host }
    throw "Temporal-ease P3/P4 exact-baseline probe failed."
  }
  if (-not (Test-Path $Output -PathType Leaf)) { throw "Temporal-ease P3/P4 exact-baseline probe produced no output: $Output" }
  return (Get-Content $Output -Raw | ConvertFrom-Json)
}

function Invoke-ProofOwnedCleanup {
  param([string]$AfterFx, [int]$TimeoutSeconds = 30)
  if (-not (Test-Path $CleanupScript -PathType Leaf)) { throw "Temporal-ease P3/P4 proof-owned cleanup script is missing: $CleanupScript" }
  if (Test-Path $CleanupMarkerPath -PathType Leaf) { Remove-Item $CleanupMarkerPath -Force }

  Write-Host "Generic cleanup could not finish through the authenticated command path; dispatching the fixed proof-owned cleanup script inside the isolated AE process."
  Start-Process -FilePath $AfterFx -ArgumentList @("-r", $CleanupScript) | Out-Null
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $Marker = $null
  while ((Get-Date) -lt $Deadline) {
    if (Test-Path $CleanupMarkerPath -PathType Leaf) {
      try { $Marker = Get-Content $CleanupMarkerPath -Raw | ConvertFrom-Json; break } catch { $Marker = $null }
    }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $Marker) { throw "Temporal-ease P3/P4 proof-owned cleanup did not produce its result marker within the bounded timeout." }
  if ($Marker.ok -ne $true -or $Marker.blankItemCount -ne 0) {
    Get-Content $CleanupMarkerPath -Raw | Write-Host
    throw "Temporal-ease P3/P4 proof-owned cleanup refused or failed."
  }
  return $Marker
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first." }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted P1/P2 result artifact is missing: $AcceptedP1P2Path" }
$AcceptedP1P2Path = (Resolve-Path $AcceptedP1P2Path).Path
$AfterFx = Resolve-RunningAfterFx $AfterFxPath
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
foreach ($Path in @($ResultPath, $BaselinePath, $CleanupVerifyPath, $CleanupMarkerPath)) {
  if (Test-Path $Path -PathType Leaf) { Remove-Item $Path -Force }
}

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-ease-p3-p4-cli.js"
  $BaselineCli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-ease-p3-p4-baseline-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled temporal-ease P3/P4 CLI not found: $Cli" }
  if (-not (Test-Path $BaselineCli -PathType Leaf)) { throw "Compiled temporal-ease P3/P4 baseline CLI not found: $BaselineCli" }

  Write-Host "EditFlow 2.0 M3 temporal-ease real-AE P3/P4 proof"
  Write-Host "Running After Effects: $AfterFx"
  Write-Host "Accepted P1/P2 dependency: $AcceptedP1P2Path"
  Write-Host "P3 emits retained AE-baseline / zero-speed-high-influence / restored-baseline visual artifacts for independent review."
  Write-Host "P4 induces failure only after a verified protocol-1.8 KeyframeEase mutation and requires exact AE Undo restoration."
  Write-Host "P3 is never self-approved by this harness; P5 is not claimed."
  Write-Host "Teardown captures the exact blank baseline before proof and verifies an exact fingerprint match after cleanup."

  $Baseline = Invoke-BaselineProbe -Cli $BaselineCli -Output $BaselinePath
  if ($Baseline.status -ne "CAPTURED" -or $Baseline.itemCount -ne 0 -or $null -ne $Baseline.filePath) {
    throw "Temporal-ease P3/P4 pre-proof baseline was not a blank unsaved project."
  }

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--accepted-p1-p2", $AcceptedP1P2Path,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + $CleanupGraceSeconds)

  while (-not $NodeProcess.HasExited) {
    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Temporal-ease P3/P4 acceptance exceeded its hard runtime."
    }
    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Temporal-ease P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))." }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json

  $CoreProofPassed = $null -eq $Result.failureError `
    -and $Result.checks.accepted_p1_p2_artifact_verified -eq $true `
    -and $Result.proofLevels.P1_validation_rejection -eq $true `
    -and $Result.proofLevels.P2_structural_readback -eq $true `
    -and $Result.proofLevels.P3_visual_artifact_emitted -eq $true `
    -and $Result.proofLevels.P3_visual_proof -eq $false `
    -and $Result.proofLevels.P4_failure_injection_rollback -eq $true `
    -and $Result.proofLevels.P5_save_reopen_reconnect_transfer -eq $false `
    -and $Result.checks.p3_baseline_artifact -eq $true `
    -and $Result.checks.p3_contrast_artifact -eq $true `
    -and $Result.checks.p3_restored_baseline_artifact -eq $true `
    -and $Result.checks.p4_induced_failure_reported -eq $true `
    -and $Result.checks.p4_response_readback_restored -eq $true `
    -and $Result.checks.p4_fingerprint_restored -eq $true `
    -and $Result.checks.p4_structural_state_restored -eq $true `
    -and $Result.checks.p4_recovery_visual_artifact_emitted -eq $true

  if (-not $CoreProofPassed) {
    Get-Content $ResultPath -Raw | Write-Host
    throw "Temporal-ease P3/P4 core real-AE structural/visual-artifact/rollback checks did not pass."
  }

  if ($Result.cleanupComplete -ne $true) {
    $CleanupErrors = @($Result.cleanupErrors)
    $KnownUndoBarrier = $CleanupErrors.Count -eq 1 -and [string]$CleanupErrors[0] -match "^cleanup: Cleanup undo budget exhausted before the exact baseline project was restored"
    $KnownReadOnlyInspectTimeout = $CleanupErrors.Count -eq 1 -and [string]$CleanupErrors[0] -match "^cleanup: CEP_COMMAND_TIMEOUT: project\.inspect m3-temporal-ease-p34-setup-[0-9]+$"
    if (-not ($KnownUndoBarrier -or $KnownReadOnlyInspectTimeout)) {
      Get-Content $ResultPath -Raw | Write-Host
      throw "Temporal-ease P3/P4 cleanup failed for an unrecognized reason; proof-owned reset is refused."
    }

    if ($KnownReadOnlyInspectTimeout) {
      Write-Host "Authenticated cleanup timed out only on the read-only project.inspect checkpoint; mutation-command timeouts remain ineligible for proof-owned reset."
    }

    $CleanupMarker = Invoke-ProofOwnedCleanup -AfterFx $AfterFx
    $CleanupVerify = Invoke-BaselineProbe -Cli $BaselineCli -Output $CleanupVerifyPath -Expected $BaselinePath
    if ($CleanupVerify.status -ne "EXACT_MATCH" -or $CleanupVerify.exact -ne $true) {
      Get-Content $CleanupVerifyPath -Raw | Write-Host
      throw "Temporal-ease P3/P4 proof-owned cleanup did not restore the exact captured blank baseline."
    }

    $Result.ok = $true
    $Result.status = "VISUAL_REVIEW_REQUIRED"
    $Result.cleanupComplete = $true
    $Result.cleanupErrors = @()
    $Result.checks | Add-Member -NotePropertyName cleanup_temp_items_absent -NotePropertyValue $true -Force
    $Result.checks | Add-Member -NotePropertyName cleanup_item_count_restored -NotePropertyValue $true -Force
    $Result.checks | Add-Member -NotePropertyName cleanup_fingerprint_restored -NotePropertyValue $true -Force
    $Result | Add-Member -NotePropertyName cleanupStrategy -NotePropertyValue "PROOF_OWNED_CLOSE_WITHOUT_SAVE_NEW_PROJECT_EXACT_BASELINE_VERIFY" -Force
    $Result | Add-Member -NotePropertyName cleanupUndoBarrierObserved -NotePropertyValue $KnownUndoBarrier -Force
    $Result | Add-Member -NotePropertyName cleanupReadOnlyInspectTimeoutObserved -NotePropertyValue $KnownReadOnlyInspectTimeout -Force
    $Result | Add-Member -NotePropertyName cleanupMarker -NotePropertyValue $CleanupMarker -Force
    $Result | Add-Member -NotePropertyName cleanupBaseline -NotePropertyValue $Baseline -Force
    $Result | Add-Member -NotePropertyName cleanupVerification -NotePropertyValue $CleanupVerify -Force
    $Result | Add-Member -NotePropertyName mainCliExitCode -NotePropertyValue $NodeProcess.ExitCode -Force
    Write-JsonUtf8NoBom -Path $ResultPath -Value $Result
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true -or -not $Result.ok) {
    Get-Content $ResultPath -Raw | Write-Host
    throw "Temporal-ease P3/P4 result was not accepted after exact baseline cleanup verification."
  }
  if ($Result.status -ne "VISUAL_REVIEW_REQUIRED" -or $Result.visualReviewRequired -ne $true) {
    throw "Temporal-ease P3/P4 harness must stop at VISUAL_REVIEW_REQUIRED until retained renders are independently reviewed."
  }
  if (-not $Result.proofLevels.P1_validation_rejection -or -not $Result.proofLevels.P2_structural_readback) {
    throw "Temporal-ease P3/P4 result did not preserve the accepted P1/P2 dependency truth."
  }
  if (-not $Result.proofLevels.P3_visual_artifact_emitted -or $Result.proofLevels.P3_visual_proof) {
    throw "Temporal-ease P3 harness must emit visual evidence without self-accepting P3."
  }
  if (-not $Result.proofLevels.P4_failure_injection_rollback -or $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    throw "Temporal-ease P3/P4 harness must prove P4 while leaving P5 false."
  }
  if (-not $Result.checks.cleanup_temp_items_absent -or -not $Result.checks.cleanup_item_count_restored -or -not $Result.checks.cleanup_fingerprint_restored) {
    throw "Temporal-ease P3/P4 proof did not restore the exact isolated project baseline."
  }

  Write-Host ("M3 temporal-ease P3/P4 harness status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
} finally {
  Pop-Location
}
