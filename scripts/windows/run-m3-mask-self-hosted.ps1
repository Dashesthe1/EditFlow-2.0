param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [int]$StartupTimeoutSeconds = 90,
  [int]$BootstrapEvidenceTimeoutSeconds = 30,
  [int]$CommandDeliveryStabilizationSeconds = 6
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$Acceptance = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p1-p2.ps1"
$PanelBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$PanelBootstrapLog = Join-Path $env:TEMP "EditFlow2-self-hosted-panel-bootstrap.log"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-mask-p1-p2"
$PublishedPanelBootstrapLog = Join-Path $ArtifactDir "panel-bootstrap.log"
$LaunchProcess = $null
$CommandProcess = $null
$StartedAfterFx = $false

function Publish-PanelBootstrapEvidence {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $PanelBootstrapLog -PathType Leaf) {
    Copy-Item $PanelBootstrapLog $PublishedPanelBootstrapLog -Force
    Write-Host "EditFlow M3 panel bootstrap evidence:"
    Get-Content $PanelBootstrapLog -Raw | Write-Host
  } else {
    Write-Warning "No EditFlow panel bootstrap evidence was produced by the fixed command bootstrap."
  }
}

function Find-ReadyTargetAfterFx {
  param([string]$ExpectedPath)
  $ResolvedExpected = (Resolve-Path $ExpectedPath).Path
  $Candidates = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  foreach ($Candidate in $Candidates) {
    $CandidatePath = $null
    $Ready = $false
    $WindowTitle = $null
    try {
      $CandidatePath = $Candidate.Path
      $WindowTitle = $Candidate.MainWindowTitle
      $Ready = $Candidate.Responding `
        -and $Candidate.MainWindowHandle -ne 0 `
        -and $WindowTitle `
        -and $WindowTitle -like "Adobe After Effects*"
    } catch {
      $CandidatePath = $null
      $Ready = $false
    }
    if ($CandidatePath -and $Ready -and [StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $CandidatePath).Path, $ResolvedExpected)) {
      return $Candidate
    }
  }
  return $null
}

if (-not [Environment]::UserInteractive) {
  throw "The EditFlow AE runner must run in an interactive Windows user session. Start the GitHub Actions runner with run.cmd while logged into the desktop; do not run it as a Windows service."
}
if (-not (Test-Path $AfterFxPath -PathType Leaf)) {
  throw "AfterFX.exe was not found at: $AfterFxPath"
}
if (-not (Test-Path $PanelBootstrap -PathType Leaf)) {
  throw "The fixed EditFlow CEP panel bootstrap is missing: $PanelBootstrap"
}
if (-not (Test-Path $Acceptance -PathType Leaf)) {
  throw "The M3 mask P1/P2 acceptance runner is missing: $Acceptance"
}
if ($PanelBootstrap -match "\s") {
  throw "The fixed AE -r bootstrap path contains whitespace. The proven two-phase target route requires an unquoted workspace path: $PanelBootstrap"
}
if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if ($StartupTimeoutSeconds -lt 10) { throw "StartupTimeoutSeconds must be at least 10." }
if ($BootstrapEvidenceTimeoutSeconds -lt 5) { throw "BootstrapEvidenceTimeoutSeconds must be at least 5." }
if ($CommandDeliveryStabilizationSeconds -lt 1) { throw "CommandDeliveryStabilizationSeconds must be at least 1." }

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  throw "Automated M3 self-hosted proof refuses to touch an already-running After Effects session. Save/close any AE work and exit After Effects before the runner starts a proof."
}

if (Test-Path $PanelBootstrapLog -PathType Leaf) { Remove-Item $PanelBootstrapLog -Force }
if (Test-Path $PublishedPanelBootstrapLog -PathType Leaf) { Remove-Item $PublishedPanelBootstrapLog -Force }

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated M3 AE proof..."
& $Installer

try {
  Write-Host "Phase 1: cold-launching a fresh declared-target After Effects instance without a script argument..."
  $LaunchProcess = Start-Process -FilePath $AfterFxPath -PassThru
  $StartedAfterFx = $true
  Write-Host ("Cold-launch request PID " + $LaunchProcess.Id + ".")

  $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $RunningAfterFx = $null
  while ((Get-Date) -lt $Deadline) {
    $RunningAfterFx = Find-ReadyTargetAfterFx $AfterFxPath
    if ($null -ne $RunningAfterFx) { break }
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $RunningAfterFx) {
    throw "After Effects did not expose its responsive project window within $StartupTimeoutSeconds seconds."
  }

  $ReadyPid = $RunningAfterFx.Id
  $ReadyTitle = $RunningAfterFx.MainWindowTitle
  Write-Host ("Phase 1 project window ready: PID " + $ReadyPid + "; title='" + $ReadyTitle + "'. Holding it stable for " + $CommandDeliveryStabilizationSeconds + " seconds before -r delivery.")
  Start-Sleep -Seconds $CommandDeliveryStabilizationSeconds

  $StableAfterFx = Find-ReadyTargetAfterFx $AfterFxPath
  if ($null -eq $StableAfterFx -or $StableAfterFx.Id -ne $ReadyPid) {
    throw "The target After Effects project window did not remain stable through the command-delivery hold."
  }

  $Arguments = @("-r", $PanelBootstrap)
  $CommandProcess = Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru
  Write-Host ("Phase 2 panel-bootstrap dispatch PID " + $CommandProcess.Id + ".")

  $BootstrapDeadline = (Get-Date).AddSeconds($BootstrapEvidenceTimeoutSeconds)
  $BootstrapSucceeded = $false
  $BootstrapFailed = $false
  while ((Get-Date) -lt $BootstrapDeadline) {
    if (Test-Path $PanelBootstrapLog -PathType Leaf) {
      $BootstrapText = Get-Content $PanelBootstrapLog -Raw
      if ($BootstrapText -match "EXECUTE_COMMAND_SENT") {
        $BootstrapSucceeded = $true
        break
      }
      if ($BootstrapText -match "RETRY_EXHAUSTED") {
        $BootstrapFailed = $true
        break
      }
    }
    Start-Sleep -Milliseconds 250
  }

  if ($BootstrapFailed) {
    throw "The fixed After Effects panel bootstrap exhausted its menu-open retries before executeCommand was reached."
  }
  if (-not $BootstrapSucceeded) {
    throw "After Effects executed the fixed panel bootstrap, but no EXECUTE_COMMAND_SENT evidence appeared within $BootstrapEvidenceTimeoutSeconds seconds."
  }

  Write-Host "After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.2 registration."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  Publish-PanelBootstrapEvidence
  if ($StartedAfterFx) {
    Write-Host "Stopping only the isolated After Effects test process set started from a zero-AE baseline..."
    Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}
