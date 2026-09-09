param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [Parameter(Mandatory = $true)][string]$LogPath,
  [int]$WatchSeconds = 900,
  [int]$PollMilliseconds = 250
)

$ErrorActionPreference = "Stop"
if ($WatchSeconds -lt 10 -or $WatchSeconds -gt 7200) { throw "WatchSeconds must be between 10 and 7200." }
if ($PollMilliseconds -lt 100 -or $PollMilliseconds -gt 2000) { throw "PollMilliseconds must be between 100 and 2000." }
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found at: $AfterFxPath" }

$ResolvedAfterFxPath = (Resolve-Path $AfterFxPath).Path
$LogDirectory = Split-Path -Parent $LogPath
if ($LogDirectory) { New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null }

function Write-SupervisorLog {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $LogPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function ConvertTo-SingleLine {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t;]+", " ").Trim())
}

# This native helper is deliberately narrow. It can enumerate AfterFX-owned windows
# and invoke a native Button control. It exposes no arbitrary coordinates, typing,
# keystrokes, shell execution, or generic message-send surface to callers.
if (-not ("EditFlow.AeHostSupervisorNative" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace EditFlow {
  public sealed class AeSupervisorWindowInfo {
    public int ProcessId;
    public long Handle;
    public bool Visible;
    public bool Enabled;
    public string ClassName = "";
    public string Title = "";
  }

  public static class AeHostSupervisorNative {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc callback, IntPtr lParam);

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
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint BM_CLICK = 0x00F5;

    private static AeSupervisorWindowInfo Snapshot(IntPtr hWnd) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      var title = new StringBuilder(1024);
      GetWindowText(hWnd, title, title.Capacity);
      var className = new StringBuilder(512);
      GetClassName(hWnd, className, className.Capacity);
      return new AeSupervisorWindowInfo {
        ProcessId = (int)processId,
        Handle = hWnd.ToInt64(),
        Visible = IsWindowVisible(hWnd),
        Enabled = IsWindowEnabled(hWnd),
        ClassName = className.ToString(),
        Title = title.ToString()
      };
    }

    public static AeSupervisorWindowInfo[] EnumerateTopLevelForProcessIds(int[] processIds) {
      var allowed = new HashSet<uint>();
      foreach (var processId in processIds) if (processId > 0) allowed.Add((uint)processId);
      var results = new List<AeSupervisorWindowInfo>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        if (allowed.Contains(processId)) results.Add(Snapshot(hWnd));
        return true;
      }, IntPtr.Zero);
      return results.ToArray();
    }

    public static AeSupervisorWindowInfo[] EnumerateChildren(long parentHandle) {
      var results = new List<AeSupervisorWindowInfo>();
      EnumChildWindows(new IntPtr(parentHandle), delegate(IntPtr hWnd, IntPtr lParam) {
        results.Add(Snapshot(hWnd));
        return true;
      }, IntPtr.Zero);
      return results.ToArray();
    }

    public static void InvokeContinueButton(long dialogHandle, long buttonHandle) {
      var dialog = new IntPtr(dialogHandle);
      var button = new IntPtr(buttonHandle);
      SetForegroundWindow(dialog);
      SetActiveWindow(dialog);
      SendMessage(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    }
  }
}
"@
}

$SeenDialogs = @{}
$InvokedDialogs = @{}
$InvocationCount = 0
$Deadline = (Get-Date).AddSeconds($WatchSeconds)
Write-SupervisorLog "START" ("afterFx=$ResolvedAfterFxPath;watchSeconds=$WatchSeconds;pollMilliseconds=$PollMilliseconds")

while ((Get-Date) -lt $Deadline) {
  $EligiblePids = @()
  foreach ($Process in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    $CandidatePath = $null
    try { $CandidatePath = (Resolve-Path $Process.Path).Path } catch {}
    if ($CandidatePath -and [StringComparer]::OrdinalIgnoreCase.Equals($CandidatePath, $ResolvedAfterFxPath)) {
      $EligiblePids += [int]$Process.Id
    }
  }

  if ($EligiblePids.Count -gt 0) {
    $Windows = @([EditFlow.AeHostSupervisorNative]::EnumerateTopLevelForProcessIds([int[]]$EligiblePids))
    foreach ($Window in $Windows) {
      if (-not $Window.Visible -or -not $Window.Enabled -or $Window.ClassName -ne "#32770") { continue }

      $HandleKey = [string]$Window.Handle
      $Children = @([EditFlow.AeHostSupervisorNative]::EnumerateChildren($Window.Handle))
      if (-not $SeenDialogs.ContainsKey($HandleKey)) {
        $SeenDialogs[$HandleKey] = $true
        Write-SupervisorLog "DIALOG" ("pid=$($Window.ProcessId);hwnd=$($Window.Handle);title=$(ConvertTo-SingleLine $Window.Title);childCount=$($Children.Count)")
        foreach ($Child in $Children) {
          Write-SupervisorLog "CHILD" ("pid=$($Child.ProcessId);hwnd=$($Child.Handle);visible=$($Child.Visible);enabled=$($Child.Enabled);class=$(ConvertTo-SingleLine $Child.ClassName);title=$(ConvertTo-SingleLine $Child.Title)")
        }
      }

      if ($InvokedDialogs.ContainsKey($HandleKey)) { continue }
      $ContextText = ((@($Window.Title) + @($Children | ForEach-Object { $_.Title })) -join " ")
      $RecoveryContext = $ContextText -match '(?i)(crash(?:ed)?|repair|recover(?:y|ed|ing)?|restore|previous\s+session|closed\s+unexpectedly|unexpected(?:ly)?\s+(?:quit|close|shutdown)|did\s+not\s+shut\s+down|safe\s+mode)'
      $ContinueButtons = @($Children | Where-Object {
        $_.Visible -and $_.Enabled -and $_.ClassName -eq "Button" -and ((($_.Title -replace "&", "").Trim()) -ieq "Continue")
      })

      if ($RecoveryContext -and $ContinueButtons.Count -eq 1) {
        $Button = $ContinueButtons[0]
        $InvokedDialogs[$HandleKey] = $true
        Write-SupervisorLog "INVOKE_CONTINUE" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);buttonHwnd=$($Button.Handle);contextMatched=true")
        [EditFlow.AeHostSupervisorNative]::InvokeContinueButton($Window.Handle, $Button.Handle)
        $InvocationCount += 1
        Start-Sleep -Milliseconds 750
      } elseif ($ContinueButtons.Count -gt 0) {
        Write-SupervisorLog "REFUSED_CONTINUE" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);continueButtons=$($ContinueButtons.Count);recoveryContext=$RecoveryContext")
      }
    }
  }

  Start-Sleep -Milliseconds $PollMilliseconds
}

Write-SupervisorLog "END" ("invocationCount=$InvocationCount;seenDialogs=$($SeenDialogs.Count)")
