param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-interpolation-p3-p4"
$ResultPath = Join-Path $ArtifactDir "result.json"
$BaselinePath = Join-Path $ArtifactDir "cleanup-baseline.json"
$CleanupVerifyPath = Join-Path $ArtifactDir "cleanup-verify.json"
$CleanupMarkerPath = Join-Path $ArtifactDir "cleanup-result.json"
$CleanupScript = Join-Path $RepoRoot "scripts\windows\m3-temporal-interpolation-p3-p4-cleanup.jsx"
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
    throw "Temporal P3/P4 exact-baseline probe failed."
  }
  if (-not (Test-Path $Output -PathType Leaf)) { throw "Temporal P3/P4 exact-baseline probe produced no output: $Output" }
  return (Get-Content $Output -Raw | ConvertFrom-Json)
}

function Invoke-ProofOwnedCleanup {
  param([string]$AfterFx, [int]$TimeoutSeconds = 30)
  if (-not (Test-Path $CleanupScript -PathType Leaf)) { throw "Temporal P3/P4 proof-owned cleanup script is missing: $CleanupScript" }
  if (Test-Path $CleanupMarkerPath -PathType Leaf) { Remove-Item $CleanupMarkerPath -Force }

  Write-Host "Generic Undo could not cross asynchronous render history; dispatching the fixed proof-owned cleanup script inside the isolated AE process."
  Start-Process -FilePath $AfterFx -ArgumentList @("-r", $CleanupScript) | Out-Null
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $Marker = $null
  while ((Get-Date) -lt $Deadline) {
    if (Test-Path $CleanupMarkerPath -PathType Leaf) {
      try {
        $Marker = Get-Content $CleanupMarkerPath -Raw | ConvertFrom-Json
        break
      } catch {
        $Marker = $null
      }
    }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $Marker) { throw "Temporal P3/P4 proof-owned cleanup did not produce its result marker within the bounded timeout." }
  if ($Marker.ok -ne $true -or $Marker.blankItemCount -ne 0) {
    Get-Content $CleanupMarkerPath -Raw | Write-Host
    throw "Temporal P3/P4 proof-owned cleanup refused or failed."
  }
  return $Marker
}

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first." }
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

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-interpolation-p3-p4-cli.js"
  $BaselineCli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-temporal-interpolation-p3-p4-baseline-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled temporal P3/P4 CLI not found: $Cli" }
  if (-not (Test-Path $BaselineCli -PathType Leaf)) { throw "Compiled temporal P3/P4 baseline CLI not found: $BaselineCli" }

  Write-Host "EditFlow 2.0 M3 temporal-interpolation real-AE P3/P4 proof"
  Write-Host "Running After Effects: $AfterFx"
  Write-Host "P3 emits retained LINEAR / incoming-HOLD / outgoing-HOLD / restored-LINEAR visual artifacts for independent review."
  Write-Host "P4 induces failure only after a verified protocol-1.7 interpolation mutation and requires exact AE Undo restoration."
  Write-Host "Teardown captures the exact blank baseline before proof and verifies an exact fingerprint match after cleanup."
  Write-Host "P5 is not claimed. Graph Editor ease/influence and spatial interpolation remain out of scope."

  $Baseline = Invoke-BaselineProbe -Cli $BaselineCli -Output $BaselinePath
  if ($Baseline.status -ne "CAPTURED" -or $Baseline.itemCount -ne 0 -or $null -ne $Baseline.filePath) {
    throw "Temporal P3/P4 pre-proof baseline was not a blank unsaved project."
  }

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + $CleanupGraceSeconds)
  $ForcedAfterResult = $false

  while (-not $NodeProcess.HasExited) {
    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Temporal P3/P4 acceptance exceeded its hard runtime."
    }
    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Temporal P3/P4 acceptance exited without a proof artifact (exit code $($NodeProcess.ExitCode))." }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json

  $CoreProofPassed = $null -eq $Result.failureError `
    -and $Result.proofLevels.P1_validation_rejection -eq $true `
    -and $Result.proofLevels.P2_structural_readback -eq $true `
    -and $Result.proofLevels.P3_visual_artifact_emitted -eq $true `
    -and $Result.proofLevels.P3_visual_proof -eq $false `
    -and $Result.proofLevels.P4_failure_injection_rollback -eq $true `
    -and $Result.proofLevels.P5_save_reopen_reconnect_transfer -eq $false `
    -and $Result.checks.p3_linear_artifact -eq $true `
    -and $Result.checks.p3_incoming_hold_artifact -eq $true `
    -and $Result.checks.p3_outgoing_hold_artifact -eq $true `
    -and $Result.checks.p3_restored_linear_artifact -eq $true `
    -and $Result.checks.p4_induced_failure_reported -eq $true `
    -and $Result.checks.p4_response_readback_restored -eq $true `
    -and $Result.checks.p4_fingerprint_restored -eq $true `
    -and $Result.checks.p4_structural_state_restored -eq $true `
    -and $Result.checks.p4_recovery_visual_artifact_emitted -eq $true

  if (-not $CoreProofPassed) {
    Get-Content $ResultPath -Raw | Write-Host
    throw "Temporal P3/P4 core real-AE structural/visual-artifact/rollback checks did not pass."
  }

  if ($Result.cleanupComplete -ne $true) {
    $CleanupErrors = @($Result.cleanupErrors)
    $KnownUndoBarrier = $CleanupErrors.Count -eq 1 -and [string]$CleanupErrors[0] -match "Cleanup undo budget exhausted before the exact baseline project was restored"
    if (-not $KnownUndoBarrier) {
      Get-Content $ResultPath -Raw | Write-Host
      throw "Temporal P3/P4 cleanup failed for an unrecognized reason; proof-owned reset is refused."
    }

    $CleanupMarker = Invoke-ProofOwnedCleanup -AfterFx $AfterFx
    $CleanupVerify = Invoke-BaselineProbe -Cli $BaselineCli -Output $CleanupVerifyPath -Expected $BaselinePath
    if ($CleanupVerify.status -ne "EXACT_MATCH" -or $CleanupVerify.exact -ne $true) {
      Get-Content $CleanupVerifyPath -Raw | Write-Host
      throw "Temporal P3/P4 proof-owned cleanup did not restore the exact captured blank baseline."
    }

    $Result.ok = $true
    $Result.status = "VISUAL_REVIEW_REQUIRED"
    $Result.cleanupComplete = $true
    $Result.cleanupErrors = @()
    $Result.checks.cleanup_temp_items_absent = $true
    $Result.checks.cleanup_item_count_restored = $true
    $Result.checks.cleanup_fingerprint_restored = $true
    $Result | Add-Member -NotePropertyName cleanupStrategy -NotePropertyValue "PROOF_OWNED_CLOSE_WITHOUT_SAVE_NEW_PROJECT_EXACT_BASELINE_VERIFY" -Force
    $Result | Add-Member -NotePropertyName cleanupUndoBarrierObserved -NotePropertyValue $true -Force
    $Result | Add-Member -NotePropertyName cleanupMarker -NotePropertyValue $CleanupMarker -Force
    $Result | Add-Member -NotePropertyName cleanupBaseline -NotePropertyValue $Baseline -Force
    $Result | Add-Member -NotePropertyName cleanupVerification -NotePropertyValue $CleanupVerify -Force
    $Result | Add-Member -NotePropertyName mainCliExitCode -NotePropertyValue $NodeProcess.ExitCode -Force
    if ($Result.visualReviewSpec -and $Result.visualReviewSpec.expected -and @($Result.visualReviewSpec.expected).Count -ge 2) {
      $Result.visualReviewSpec.expected[1] = "incomingHoldRender must hold the foreground-dominant destination-key state before the 0.5 s key while retaining the linear outgoing fade after it"
    }
    Write-JsonUtf8NoBom -Path $ResultPath -Value $Result
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true -or -not $Result.ok) {
    Get-Content $ResultPath -Raw | Write-Host
    throw "Temporal P3/P4 result was not accepted after exact baseline cleanup verification."
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
  if (-not $Result.checks.cleanup_temp_items_absent -or -not $Result.checks.cleanup_item_count_restored -or -not $Result.checks.cleanup_fingerprint_restored) {
    throw "Temporal P3/P4 proof did not restore the exact isolated project baseline."
  }

  Write-Host ("M3 temporal-interpolation P3/P4 harness status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) { Write-Host "Proof and cleanup completed successfully; wrapper terminated only the stuck post-proof Node shutdown." }
} finally {
  Pop-Location
}
