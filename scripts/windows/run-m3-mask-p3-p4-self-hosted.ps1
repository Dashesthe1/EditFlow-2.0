param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [int]$StartupTimeoutSeconds = 45,
  [int]$MaxColdStartAttempts = 2,
  [int]$RetryCooldownSeconds = 3,
  [int]$BootstrapEvidenceTimeoutSeconds = 30,
  [int]$CommandDeliveryStabilizationSeconds = 6
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$Acceptance = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4.ps1"
$PanelBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$PanelBootstrapLog = Join-Path $env:TEMP "EditFlow2-self-hosted-panel-bootstrap.log"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-mask-p3-p4"
$PublishedPanelBootstrapLog = Join-Path $ArtifactDir "panel-bootstrap.log"
$StartupDiagnosticsPath = Join-Path $ArtifactDir "startup-diagnostics.log"
$LaunchProcess = $null
$CommandProcess = $null
$StartedAfterFx = $false

# Read-only Win32 top-level-window metadata probe. This deliberately exposes no
# input, focus, click, message-send, or keyboard APIs. It is used only to identify
# which AE-owned window/dialog is blocking project readiness on the isolated
# runner workstation.
if (-not ("EditFlow.NativeWindowProbe" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace EditFlow {
  public sealed class NativeWindowInfo {
    public int ProcessId;
    public long Handle;
    public bool Visible;
    public bool Enabled;
    public string ClassName = "";
    public string Title = "";
  }

  public static class NativeWindowProbe {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowEnabled(IntPtr hWnd);

    public static NativeWindowInfo[] EnumerateForProcessIds(int[] processIds) {
      var allowed = new HashSet<uint>();
      foreach (var processId in processIds) {
        if (processId > 0) allowed.Add((uint)processId);
      }

      var results = new List<NativeWindowInfo>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        if (!allowed.Contains(processId)) return true;

        var title = new StringBuilder(1024);
        GetWindowText(hWnd, title, title.Capacity);
        var className = new StringBuilder(512);
        GetClassName(hWnd, className, className.Capacity);

        results.Add(new NativeWindowInfo {
          ProcessId = (int)processId,
          Handle = hWnd.ToInt64(),
          Visible = IsWindowVisible(hWnd),
          Enabled = IsWindowEnabled(hWnd),
          ClassName = className.ToString(),
          Title = title.ToString()
        });
        return true;
      }, IntPtr.Zero);

      return results.ToArray();
    }
  }
}
"@
}

function Write-StartupDiagnostic {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $StartupDiagnosticsPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function ConvertTo-SingleLineDiagnostic {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t;]+", " ").Trim())
}

function Write-AeTopLevelWindowSnapshot {
  param([string]$Stage)

  $Processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  $ProcessIds = @($Processes | ForEach-Object { [int]$_.Id })
  if ($ProcessIds.Count -eq 0) {
    Write-StartupDiagnostic ($Stage + "_WINDOWS") "windowCount=0;aeCount=0"
    return
  }

  try {
    $Windows = @([EditFlow.NativeWindowProbe]::EnumerateForProcessIds([int[]]$ProcessIds))
    Write-StartupDiagnostic ($Stage + "_WINDOWS") ("windowCount=" + $Windows.Count + ";aeCount=" + $ProcessIds.Count)
    foreach ($Window in $Windows) {
      $Title = ConvertTo-SingleLineDiagnostic $Window.Title
      $ClassName = ConvertTo-SingleLineDiagnostic $Window.ClassName
      Write-StartupDiagnostic ($Stage + "_WINDOW") ("pid=$($Window.ProcessId);hwnd=$($Window.Handle);visible=$($Window.Visible);enabled=$($Window.Enabled);class=$ClassName;title=$Title")
    }
  } catch {
    Write-StartupDiagnostic ($Stage + "_WINDOW_PROBE_ERROR") (ConvertTo-SingleLineDiagnostic $_.Exception.Message)
  }
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
    $Detail = "pid=$($Process.Id);sessionId=$($Process.SessionId);startUtc=$Started;responding=$Responding;mainWindowHandle=$WindowHandle;title=$(ConvertTo-SingleLineDiagnostic $WindowTitle);path=$(ConvertTo-SingleLineDiagnostic $Path)"
    try {
      $Cim = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $Process.Id)
      if ($Cim) { $Detail += ";parentPid=$($Cim.ParentProcessId);commandLine=$(ConvertTo-SingleLineDiagnostic $Cim.CommandLine)" }
    } catch {
      $Detail += ";cimError=$(ConvertTo-SingleLineDiagnostic $_.Exception.Message)"
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
    Write-Host "EditFlow M3 AE startup/process/window diagnostics:"
    Get-Content $StartupDiagnosticsPath -Raw | Write-Host
  }
}

function Find-ProjectReadyTargetAfterFx {
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
      # The successful accepted M2 run did not dispatch -r until AE exposed a real
      # titled project window. Run #5 proved that a responding blank-title splash
      # window can have a nonzero handle yet still spawn a second AfterFX process
      # instead of routing -r to the existing instance. Require the proven project
      # window signal before command delivery; EXECUTE_COMMAND_SENT remains the
      # stronger downstream proof that the fixed bootstrap actually ran.
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

function Stop-OwnedAfterFxSet {
  param(
    [string]$StagePrefix,
    [int]$GraceSeconds = 10
  )

  $OwnedProcesses = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($OwnedProcesses.Count -eq 0) {
    Write-StartupDiagnostic ($StagePrefix + "_ALREADY_ZERO") "aeCount=0"
    return
  }

  $OwnedIds = ($OwnedProcesses | ForEach-Object { $_.Id }) -join ","
  Write-Host ("Closing only the runner-owned After Effects process set gracefully: " + $OwnedIds)
  Write-StartupDiagnostic ($StagePrefix + "_BEGIN") ("pids=" + $OwnedIds)

  foreach ($Owned in $OwnedProcesses) {
    try {
      $Closed = $Owned.CloseMainWindow()
      Write-StartupDiagnostic ($StagePrefix + "_CLOSE_MAIN_WINDOW") ("pid=$($Owned.Id);sent=$Closed")
    } catch {
      Write-StartupDiagnostic ($StagePrefix + "_CLOSE_MAIN_WINDOW_ERROR") ("pid=$($Owned.Id);error=$(ConvertTo-SingleLineDiagnostic $_.Exception.Message)")
    }
  }

  $GraceDeadline = (Get-Date).AddSeconds($GraceSeconds)
  do {
    $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    if ($Remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $GraceDeadline)

  $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Remaining.Count -gt 0) {
    $RemainingIds = ($Remaining | ForEach-Object { $_.Id }) -join ","
    Write-Warning ("Graceful AE close did not finish; force-stopping only runner-owned process set: " + $RemainingIds)
    Write-StartupDiagnostic ($StagePrefix + "_FORCE_STOP") ("pids=" + $RemainingIds)
    $Remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    foreach ($Owned in $Remaining) {
      Wait-Process -Id $Owned.Id -Timeout 15 -ErrorAction SilentlyContinue
    }

    # Windows may report the force-stopped AE process for a short interval after
    # Wait-Process returns. Run #6 observed the process disappear roughly half a
    # second later. Poll for a bounded five-second settlement window so a genuine
    # successful stop is not mistaken for a failed zero-baseline cleanup.
    Write-StartupDiagnostic ($StagePrefix + "_POST_FORCE_SETTLEMENT_BEGIN") "timeoutSeconds=5"
    $PostForceDeadline = (Get-Date).AddSeconds(5)
    do {
      $PostForceRemaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($PostForceRemaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $PostForceDeadline)
    Write-StartupDiagnostic ($StagePrefix + "_POST_FORCE_SETTLEMENT_END") ("aeCount=" + @($PostForceRemaining).Count)
  }

  $StillRunning = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($StillRunning.Count -gt 0) {
    $StillRunningIds = ($StillRunning | ForEach-Object { $_.Id }) -join ","
    Write-StartupDiagnostic ($StagePrefix + "_FAILED_TO_ZERO") ("pids=" + $StillRunningIds)
    throw "Runner-owned After Effects process set did not return to zero after bounded cleanup: $StillRunningIds"
  }
  Write-StartupDiagnostic ($StagePrefix + "_ZERO_CONFIRMED") "aeCount=0"
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
  throw "The M3 mask P3/P4 acceptance runner is missing: $Acceptance"
}
if ($PanelBootstrap -match "\s") {
  throw "The fixed AE -r bootstrap path contains whitespace. The proven two-phase target route requires an unquoted workspace path: $PanelBootstrap"
}
if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if ($StartupTimeoutSeconds -lt 20) { throw "StartupTimeoutSeconds must be at least 20 seconds per cold-start attempt." }
if ($MaxColdStartAttempts -lt 1 -or $MaxColdStartAttempts -gt 2) { throw "MaxColdStartAttempts must be 1 or 2." }
if ($RetryCooldownSeconds -lt 1 -or $RetryCooldownSeconds -gt 10) { throw "RetryCooldownSeconds must be between 1 and 10." }
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
Write-StartupDiagnostic "PRELAUNCH" ("runnerIdentity=$RunnerIdentity;runnerPid=$PID;runnerSessionId=$($RunnerProcess.SessionId);afterFx=$AfterFxPath;startupAttempts=$MaxColdStartAttempts;startupTimeoutSeconds=$StartupTimeoutSeconds")

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated M3 AE proof..."
& $Installer

# The host proof hook is inert unless this exact environment flag is inherited by
# the runner-owned AE process. It is removed again during bounded cleanup.
$env:EDITFLOW_M3_MASK_P4_PROOF = "1"
Write-StartupDiagnostic "P4_PROOF_INJECTION_ARMED" "env=EDITFLOW_M3_MASK_P4_PROOF"

try {
  $RunningAfterFx = $null

  for ($Attempt = 1; $Attempt -le $MaxColdStartAttempts; $Attempt++) {
    Write-Host ("Phase 1 attempt " + $Attempt + "/" + $MaxColdStartAttempts + ": cold-launching the declared-target After Effects instance without a script argument...")
    Write-StartupDiagnostic "COLD_START_ATTEMPT_BEGIN" ("attempt=$Attempt;maxAttempts=$MaxColdStartAttempts")
    $LaunchProcess = Start-Process -FilePath $AfterFxPath -PassThru
    $StartedAfterFx = $true
    Write-Host ("Cold-launch request PID " + $LaunchProcess.Id + ".")
    Write-AeProcessSnapshot ("COLD_LAUNCH_ATTEMPT_" + $Attempt)
    Write-AeTopLevelWindowSnapshot ("COLD_LAUNCH_ATTEMPT_" + $Attempt)

    $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $NextStartupDiagnosticAt = Get-Date
    while ((Get-Date) -lt $Deadline) {
      $RunningAfterFx = Find-ProjectReadyTargetAfterFx $AfterFxPath
      if ($null -ne $RunningAfterFx) { break }
      if ((Get-Date) -ge $NextStartupDiagnosticAt) {
        $Stage = "COLD_START_WAIT_ATTEMPT_" + $Attempt
        Write-AeProcessSnapshot $Stage
        Write-AeTopLevelWindowSnapshot $Stage
        $NextStartupDiagnosticAt = (Get-Date).AddSeconds(5)
      }
      Start-Sleep -Milliseconds 500
    }
    $ReadyCheckStage = "COLD_START_READY_CHECK_ATTEMPT_" + $Attempt
    Write-AeProcessSnapshot $ReadyCheckStage
    Write-AeTopLevelWindowSnapshot $ReadyCheckStage

    if ($null -ne $RunningAfterFx) {
      Write-StartupDiagnostic "COLD_START_PROJECT_READY" ("attempt=$Attempt;pid=$($RunningAfterFx.Id);title=$(ConvertTo-SingleLineDiagnostic $RunningAfterFx.MainWindowTitle)")
      Write-AeTopLevelWindowSnapshot "COLD_START_PROJECT_READY"
      break
    }

    Write-StartupDiagnostic "COLD_START_ATTEMPT_FAILED" ("attempt=$Attempt;timeoutSeconds=$StartupTimeoutSeconds")
    if ($Attempt -lt $MaxColdStartAttempts) {
      Write-Warning ("After Effects did not reach a titled project-ready window on cold-start attempt " + $Attempt + ". Recycling only the zero-baseline runner-owned AE process set, then retrying once.")
      Write-StartupDiagnostic "COLD_START_RETRY" ("failedAttempt=$Attempt;nextAttempt=" + ($Attempt + 1))
      Stop-OwnedAfterFxSet -StagePrefix ("RETRY_CLEANUP_ATTEMPT_" + $Attempt)
      Start-Sleep -Seconds $RetryCooldownSeconds
      $RunningAfterFx = $null
    }
  }

  if ($null -eq $RunningAfterFx) {
    Write-AeTopLevelWindowSnapshot "COLD_START_FINAL_FAILURE"
    throw "After Effects did not expose the proven titled project-ready window after $MaxColdStartAttempts bounded cold-start attempt(s). Startup diagnostics were preserved for evidence; command delivery was not attempted."
  }

  $ReadyPid = $RunningAfterFx.Id
  $ReadyTitle = $RunningAfterFx.MainWindowTitle
  Write-StartupDiagnostic "COMMAND_TARGET_READY" ("pid=$ReadyPid;mainWindowHandle=$($RunningAfterFx.MainWindowHandle);title=$(ConvertTo-SingleLineDiagnostic $ReadyTitle)")
  Write-AeTopLevelWindowSnapshot "COMMAND_TARGET_READY"
  Write-Host ("Phase 1 project-ready window confirmed: PID " + $ReadyPid + "; title='" + $ReadyTitle + "'. Holding it stable for " + $CommandDeliveryStabilizationSeconds + " seconds before -r delivery.")
  Start-Sleep -Seconds $CommandDeliveryStabilizationSeconds

  $StableAfterFx = Find-ProjectReadyTargetAfterFx $AfterFxPath
  if ($null -eq $StableAfterFx -or $StableAfterFx.Id -ne $ReadyPid) {
    Write-AeProcessSnapshot "COMMAND_TARGET_STABILITY_FAILURE"
    Write-AeTopLevelWindowSnapshot "COMMAND_TARGET_STABILITY_FAILURE"
    throw "The target After Effects titled project window did not remain stable through the command-delivery hold."
  }

  $Arguments = @("-r", $PanelBootstrap)
  $CommandProcess = Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru
  Write-Host ("Phase 2 panel-bootstrap dispatch PID " + $CommandProcess.Id + ".")
  Write-AeProcessSnapshot "PANEL_BOOTSTRAP_DISPATCH"
  Write-AeTopLevelWindowSnapshot "PANEL_BOOTSTRAP_DISPATCH"

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
    Write-AeTopLevelWindowSnapshot "PANEL_BOOTSTRAP_RETRY_EXHAUSTED"
    throw "The fixed After Effects panel bootstrap exhausted its menu-open retries before executeCommand was reached."
  }
  if (-not $BootstrapSucceeded) {
    Write-AeProcessSnapshot "PANEL_BOOTSTRAP_EVIDENCE_TIMEOUT"
    Write-AeTopLevelWindowSnapshot "PANEL_BOOTSTRAP_EVIDENCE_TIMEOUT"
    throw "After Effects did not produce fixed-bootstrap EXECUTE_COMMAND_SENT evidence within $BootstrapEvidenceTimeoutSeconds seconds."
  }

  Write-Host "After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.2 registration."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
  Write-StartupDiagnostic "P4_PROOF_INJECTION_DISARMED" "env=EDITFLOW_M3_MASK_P4_PROOF"
  Write-AeProcessSnapshot "CLEANUP_BEGIN"
  Write-AeTopLevelWindowSnapshot "CLEANUP_BEGIN"
  try {
    if ($StartedAfterFx) {
      Stop-OwnedAfterFxSet -StagePrefix "FINAL_CLEANUP"
    }
  } finally {
    Publish-Evidence
  }
}
