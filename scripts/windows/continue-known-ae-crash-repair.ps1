param(
  [Parameter(Mandatory = $true)]
  [string]$AfterFxPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [Parameter(Mandatory = $true)]
  [DateTime]$StartedAfterUtc,
  [int]$DurationSeconds = 180,
  [int]$PollMilliseconds = 250
)

$ErrorActionPreference = "Stop"
if ($env:EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE -ne "1") {
  throw "Crash Repair Continue helper is proof-runner-only and requires EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE=1."
}
if ($DurationSeconds -lt 10 -or $DurationSeconds -gt 300) { throw "DurationSeconds must be between 10 and 300." }
if ($PollMilliseconds -lt 100 -or $PollMilliseconds -gt 2000) { throw "PollMilliseconds must be between 100 and 2000." }
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe is missing: $AfterFxPath" }

$ExpectedAfterFxPath = (Resolve-Path $AfterFxPath).Path
$OutputDir = Split-Path -Parent $OutputPath
if ($OutputDir) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
if (Test-Path $OutputPath -PathType Leaf) { Remove-Item $OutputPath -Force }

if (-not ("EditFlow.CrashRepairWindowReader" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace EditFlow {
  public sealed class CrashRepairWindowInfo {
    public int ProcessId;
    public long Handle;
    public bool Visible;
    public bool Enabled;
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
    public string ClassName = "";
    public string Title = "";
  }

  public static class CrashRepairWindowReader {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    private delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
      public int Left;
      public int Top;
      public int Right;
      public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);

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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    private static CrashRepairWindowInfo Describe(IntPtr hWnd) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      var title = new StringBuilder(2048);
      GetWindowText(hWnd, title, title.Capacity);
      var className = new StringBuilder(512);
      GetClassName(hWnd, className, className.Capacity);
      RECT rect;
      var hasRect = GetWindowRect(hWnd, out rect);
      return new CrashRepairWindowInfo {
        ProcessId = (int)processId,
        Handle = hWnd.ToInt64(),
        Visible = IsWindowVisible(hWnd),
        Enabled = IsWindowEnabled(hWnd),
        Left = hasRect ? rect.Left : 0,
        Top = hasRect ? rect.Top : 0,
        Right = hasRect ? rect.Right : 0,
        Bottom = hasRect ? rect.Bottom : 0,
        ClassName = className.ToString(),
        Title = title.ToString()
      };
    }

    public static CrashRepairWindowInfo[] EnumerateTopLevelForProcessId(int processId) {
      var results = new List<CrashRepairWindowInfo>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint owner;
        GetWindowThreadProcessId(hWnd, out owner);
        if (owner == (uint)processId) results.Add(Describe(hWnd));
        return true;
      }, IntPtr.Zero);
      return results.ToArray();
    }

    public static CrashRepairWindowInfo[] EnumerateChildren(long parentHandle) {
      var results = new List<CrashRepairWindowInfo>();
      EnumChildWindows(new IntPtr(parentHandle), delegate(IntPtr hWnd, IntPtr lParam) {
        results.Add(Describe(hWnd));
        return true;
      }, IntPtr.Zero);
      return results.ToArray();
    }
  }
}
"@
}

Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop

function Clean-DiagnosticText {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t]+", " ").Trim())
}

function Write-RecoveryLine {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $OutputPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function Get-ExactCrashRepairDialog {
  param($Process)

  try {
    $Process.Refresh()
    if ($Process.HasExited) { return $null }
    if ($Process.StartTime.ToUniversalTime() -lt $StartedAfterUtc.ToUniversalTime()) { return $null }
    if ([string]::IsNullOrWhiteSpace($Process.Path)) { return $null }
    if (-not [string]::Equals((Resolve-Path $Process.Path).Path, $ExpectedAfterFxPath, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  } catch { return $null }

  $TopLevels = @([EditFlow.CrashRepairWindowReader]::EnumerateTopLevelForProcessId([int]$Process.Id))
  $VisibleTopLevels = @($TopLevels | Where-Object { $_.Visible })
  if ($VisibleTopLevels.Count -ne 1) { return $null }

  $Dialog = $VisibleTopLevels[0]
  if ($Dialog.ClassName -ne "#32770" -or $Dialog.Title -ne "" -or -not $Dialog.Enabled) { return $null }
  if ([long]$Process.MainWindowHandle -ne [long]$Dialog.Handle) { return $null }

  $Width = [int]$Dialog.Right - [int]$Dialog.Left
  $Height = [int]$Dialog.Bottom - [int]$Dialog.Top
  # Run-7 retained evidence established the stable 150%-DPI Crash Repair Options
  # surface at 781x492. Keep a narrow tolerance for window-border rounding only.
  if ($Width -lt 760 -or $Width -gt 800 -or $Height -lt 470 -or $Height -gt 510) { return $null }

  $Children = @([EditFlow.CrashRepairWindowReader]::EnumerateChildren([long]$Dialog.Handle))
  $VisibleViewContainers = @($Children | Where-Object {
    $_.Visible -and $_.Enabled -and $_.ClassName -eq "DroverLord - Window Class" -and $_.Title -eq "OS_ViewContainer"
  })
  $HiddenViewContainers = @($Children | Where-Object {
    -not $_.Visible -and $_.ClassName -eq "DroverLord - Window Class" -and $_.Title -eq "OS_ViewContainer"
  })
  $HiddenEditContainers = @($Children | Where-Object {
    -not $_.Visible -and $_.ClassName -eq "DroverLord - Window Class" -and $_.Title -eq "OS_EditTextContainer"
  })
  $HiddenEdits = @($Children | Where-Object { -not $_.Visible -and $_.ClassName -eq "Edit" })
  if ($VisibleViewContainers.Count -ne 1 -or $HiddenViewContainers.Count -lt 1 -or $HiddenEditContainers.Count -lt 1 -or $HiddenEdits.Count -lt 1) {
    return $null
  }

  $HiddenAeApplications = @($TopLevels | Where-Object {
    -not $_.Visible -and $_.ClassName -like "AE_CApplication_*" -and $_.Title -eq "Adobe After Effects"
  })
  if ($HiddenAeApplications.Count -ne 1) { return $null }

  return $Dialog
}

Write-RecoveryLine "RECOVERY_WATCH_START" ("startedAfterUtc=$($StartedAfterUtc.ToUniversalTime().ToString('o'));afterFx=$ExpectedAfterFxPath;durationSeconds=$DurationSeconds")
$Deadline = (Get-Date).AddSeconds($DurationSeconds)
$Handled = @{}
$HandledCount = 0
while ((Get-Date) -lt $Deadline) {
  $Processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  foreach ($Process in $Processes) {
    if ($Handled.ContainsKey([int]$Process.Id)) { continue }
    $Dialog = Get-ExactCrashRepairDialog -Process $Process
    if ($null -eq $Dialog) { continue }

    $Handled[[int]$Process.Id] = $true
    $Width = [int]$Dialog.Right - [int]$Dialog.Left
    $Height = [int]$Dialog.Bottom - [int]$Dialog.Top
    Write-RecoveryLine "EXACT_CRASH_REPAIR_MATCH" ("pid=$($Process.Id);hwnd=$($Dialog.Handle);width=$Width;height=$Height")

    [void][EditFlow.CrashRepairWindowReader]::SetForegroundWindow([IntPtr]::new([long]$Dialog.Handle))
    Start-Sleep -Milliseconds 125
    $Foreground = [EditFlow.CrashRepairWindowReader]::GetForegroundWindow().ToInt64()
    if ($Foreground -ne [long]$Dialog.Handle) {
      Write-RecoveryLine "RECOVERY_REFUSED_FOREGROUND_MISMATCH" ("pid=$($Process.Id);expectedHwnd=$($Dialog.Handle);foregroundHwnd=$Foreground")
      continue
    }

    # Run-7 retained pixels prove that Continue is the default focused action on
    # this exact Crash Repair Options surface. One Enter is safer than coordinate
    # clicking and cannot select Reset Preferences / Safe Mode / Manage Plugins.
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    $HandledCount += 1
    Write-RecoveryLine "CONTINUE_ENTER_SENT" ("pid=$($Process.Id);hwnd=$($Dialog.Handle)")

    $DismissDeadline = (Get-Date).AddSeconds(8)
    $Dismissed = $false
    while ((Get-Date) -lt $DismissDeadline) {
      Start-Sleep -Milliseconds 100
      try {
        $Process.Refresh()
        if ($Process.HasExited) { break }
        $Current = @([EditFlow.CrashRepairWindowReader]::EnumerateTopLevelForProcessId([int]$Process.Id))
        if (-not ($Current | Where-Object { $_.Visible -and [long]$_.Handle -eq [long]$Dialog.Handle })) {
          $Dismissed = $true
          break
        }
      } catch { break }
    }
    if ($Dismissed) {
      Write-RecoveryLine "CRASH_REPAIR_DISMISSED" ("pid=$($Process.Id);hwnd=$($Dialog.Handle)")
    } else {
      Write-RecoveryLine "RECOVERY_INCOMPLETE" ("pid=$($Process.Id);hwnd=$($Dialog.Handle)")
    }

    if ($HandledCount -ge 2) {
      Write-RecoveryLine "RECOVERY_WATCH_END" ("handledCount=$HandledCount;reason=max_handled")
      exit 0
    }
  }
  Start-Sleep -Milliseconds $PollMilliseconds
}

Write-RecoveryLine "RECOVERY_WATCH_END" ("handledCount=$HandledCount;reason=deadline")
