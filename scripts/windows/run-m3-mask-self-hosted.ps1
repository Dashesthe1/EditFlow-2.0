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
$StartupDiagnosticsPath = Join-Path $ArtifactDir "startup-diagnostics.log"
$LaunchProcess = $null
$CommandProcess = $null
$StartedAfterFx = $false

function Write-StartupDiagnostic {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $StartupDiagnosticsPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function Write-AeProcessSnapshot {
  param([string]$Stage)
  $Processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  Write-StartupDiagnostic $Stage ("aeCount=" + $Processes.Count)
  foreach ($Process in $Processes) {
    $Path = $null
    $Started = $null
    $Responding = $null
    $WindowHandle = $null
    $WindowTitle = $null
    try { $Path = $Process.Path } catch {}
    try { $Started = $Process.StartTime.ToUniversalTime().ToString("o") } catch {}
    try { $Responding = $Process.Responding } catch {}
    try { $WindowHandle = $Process.MainWindowHandle } catch {}
    try { $WindowTitle = $Process.MainWindowTitle } catch {}
    $Detail = "pid=$($Process.Id);sessionId=$($Process.SessionId);startUtc=$Started;responding=$Responding;mainWindowHandle=$WindowHandle;title=$WindowTitle;path=$Path"
    try {
      $Cim = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $Process.Id)
      if ($Cim) { $Detail += ";parentPid=$($Cim.ParentProcessId);commandLine=$($Cim.CommandLine)" }
    } catch {
      $Detail += ";cimError=$($_.Exception.Message)"
    }
    Write-StartupDiagnostic $Stage $Detail
  }
}

function Publish-Evidence {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $PanelBootstrapLog -PathType Leaf) {
    Copy-Item $PanelBootstrapLog $PublishedPanelBootstrapLog -Force
    Write-Host "EditFlow M3 panel bootstrap evidence:"
    Get-Content $PanelBootstrapLog -Raw | Write-Host
  } else {
    Write-Warning "No EditFlow panel bootstrap evidence was produced by the fixed command bootstrap."
  }
  if (Test-Path $StartupDiagnosticsPath -PathType Leaf) {
    Write-Host "EditFlow M3 AE startup/process diagnostics:"
    Get-Content $StartupDiagnosticsPath -Raw | Write-Host
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

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $PanelBootstrapLog -PathType Leaf) { Remove-Item $PanelBootstrapLog -Force }
if (Test-Path $PublishedPanelBootstrapLog -PathType Leaf) { Remove-Item $PublishedPanelBootstrapLog -Force }
if (Test-Path $StartupDiagnosticsPath -PathType Leaf) { Remove-Item $StartupDiagnosticsPath -Force }

$RunnerProcess = Get-Process -Id $PID
$RunnerIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-StartupDiagnostic "PRELAUNCH" ("runnerIdentity=$RunnerIdentity;runnerPid=$PID;runnerSessionId=$($RunnerProcess.SessionId);afterFx=$AfterFxPath")

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated M3 AE proof..."
& $Installer

try {
  Write-Host "Phase 1: cold-launching a fresh declared-target After Effects instance without a script argument..."
  $LaunchProcess = Start-Process -FilePath $AfterFxPath -PassThru
  $StartedAfterFx = $true
  Write-Host ("Cold-launch request PID " + $LaunchProcess.Id + ".")
  Write-AeProcessSnapshot "COLD_LAUNCH"

  $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $NextStartupDiagnosticAt = Get-Date
  $RunningAfterFx = $null
  while ((Get-Date) -lt $Deadline) {
    $RunningAfterFx = Find-ReadyTargetAfterFx $AfterFxPath
    if ($null -ne $RunningAfterFx) { break }
    if ((Get-Date) -ge $NextStartupDiagnosticAt) {
      Write-AeProcessSnapshot "COLD_START_WAIT"
      $NextStartupDiagnosticAt = (Get-Date).AddSeconds(5)
    }
    Start-Sleep -Milliseconds 500
  }
  Write-AeProcessSnapshot "COLD_START_READY_CHECK"

  if ($null -eq $RunningAfterFx) {
    throw "After Effects did not expose its responsive project window within $StartupTimeoutSeconds seconds. Startup diagnostics were preserved for evidence."
  }

  $ReadyPid = $RunningAfterFx.Id
  $ReadyTitle = $RunningAfterFx.MainWindowTitle
  Write-StartupDiagnostic "COMMAND_TARGET_READY" ("pid=$ReadyPid;mainWindowHandle=$($RunningAfterFx.MainWindowHandle);title=$ReadyTitle")
  Write-Host ("Phase 1 project window ready: PID " + $ReadyPid + "; title='" + $ReadyTitle + "'. Holding it stable for " + $CommandDeliveryStabilizationSeconds + " seconds before -r delivery.")
  Start-Sleep -Seconds $CommandDeliveryStabilizationSeconds

  $StableAfterFx = Find-ReadyTargetAfterFx $AfterFxPath
  if ($null -eq $StableAfterFx -or $StableAfterFx.Id -ne $ReadyPid) {
    Write-AeProcessSnapshot "COMMAND_TARGET_STABILITY_FAILURE"
    throw "The target After Effects project window did not remain stable through the command-delivery hold."
  }

  $Arguments = @("-r", $PanelBootstrap)
  $CommandProcess = Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru
  Write-Host ("Phase 2 panel-bootstrap dispatch PID " + $CommandProcess.Id + ".")
  Write-AeProcessSnapshot "PANEL_BOOTSTRAP_DISPATCH"

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
    Write-AeProcessSnapshot "PANEL_BOOTSTRAP_EVIDENCE_TIMEOUT"
    throw "After Effects executed the fixed panel bootstrap, but no EXECUTE_COMMAND_SENT evidence appeared within $BootstrapEvidenceTimeoutSeconds seconds."
  }

  Write-Host "After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.2 registration."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  Write-AeProcessSnapshot "CLEANUP_BEGIN"
  Publish-Evidence
  if ($StartedAfterFx) {
    $OwnedProcesses = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    if ($OwnedProcesses.Count -gt 0) {
      $OwnedIds = ($OwnedProcesses | ForEach-Object { $_.Id }) -join ","
      Write-Host ("Closing only the isolated After Effects test process set gracefully: " + $OwnedIds)
      foreach ($Owned in $OwnedProcesses) {
        try {
          $Closed = $Owned.CloseMainWindow()
          Write-StartupDiagnostic "CLEANUP_CLOSE_MAIN_WINDOW" ("pid=$($Owned.Id);sent=$Closed")
        } catch {
          Write-StartupDiagnostic "CLEANUP_CLOSE_MAIN_WINDOW_ERROR" ("pid=$($Owned.Id);error=$($_.Exception.Message)")
        }
      }

      $GraceDeadline = (Get-Date).AddSeconds(10)
      do {
        $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
        if ($Remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
      } while ((Get-Date) -lt $GraceDeadline)

      $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($Remaining.Count -gt 0) {
        $RemainingIds = ($Remaining | ForEach-Object { $_.Id }) -join ","
        Write-Warning ("Graceful AE close did not finish; force-stopping only runner-owned process set: " + $RemainingIds)
        Write-StartupDiagnostic "CLEANUP_FORCE_STOP" ("pids=$RemainingIds")
        $Remaining | Stop-Process -Force -ErrorAction SilentlyContinue
        foreach ($Owned in $Remaining) {
          Wait-Process -Id $Owned.Id -Timeout 15 -ErrorAction SilentlyContinue
        }
      }
    }
  }
}
