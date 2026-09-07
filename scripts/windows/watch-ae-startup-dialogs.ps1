param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [int]$DurationSeconds = 140,
  [int]$PollMilliseconds = 2000
)

$ErrorActionPreference = "Stop"
if ($DurationSeconds -lt 10 -or $DurationSeconds -gt 300) { throw "DurationSeconds must be between 10 and 300." }
if ($PollMilliseconds -lt 250 -or $PollMilliseconds -gt 10000) { throw "PollMilliseconds must be between 250 and 10000." }

$OutputDir = Split-Path -Parent $OutputPath
if ($OutputDir) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }

# Diagnostic-only Win32/UI Automation reader. It deliberately exposes no input,
# focus, click, keyboard, SendMessage/PostMessage, InvokePattern, or mutation APIs.
# Its only purpose is to identify a startup dialog that prevents the isolated
# runner-owned After Effects process from reaching its normal project window.
if (-not ("EditFlow.StartupDialogReader" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace EditFlow {
  public sealed class StartupWindowInfo {
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

  public static class StartupDialogReader {
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

    private static StartupWindowInfo Describe(IntPtr hWnd) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      var title = new StringBuilder(2048);
      GetWindowText(hWnd, title, title.Capacity);
      var className = new StringBuilder(512);
      GetClassName(hWnd, className, className.Capacity);
      RECT rect;
      var hasRect = GetWindowRect(hWnd, out rect);
      return new StartupWindowInfo {
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

    public static StartupWindowInfo[] EnumerateTopLevelForProcessIds(int[] processIds) {
      var allowed = new HashSet<uint>();
      foreach (var processId in processIds) if (processId > 0) allowed.Add((uint)processId);
      var results = new List<StartupWindowInfo>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        if (allowed.Contains(processId)) results.Add(Describe(hWnd));
        return true;
      }, IntPtr.Zero);
      return results.ToArray();
    }

    public static StartupWindowInfo[] EnumerateChildren(long parentHandle) {
      var results = new List<StartupWindowInfo>();
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

try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
  $UiAutomationAvailable = $true
} catch {
  $UiAutomationAvailable = $false
}

try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
  $ScreenCaptureAvailable = $true
} catch {
  $ScreenCaptureAvailable = $false
}

function Clean-DiagnosticText {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t]+", " ").Trim())
}

function Write-DiagnosticLine {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $OutputPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function Save-ReadOnlyDialogScreenshot {
  param($Dialog)

  if (-not $ScreenCaptureAvailable) { return $null }
  $Width = [int]$Dialog.Right - [int]$Dialog.Left
  $Height = [int]$Dialog.Bottom - [int]$Dialog.Top
  if ($Width -lt 1 -or $Height -lt 1 -or $Width -gt 8192 -or $Height -gt 8192) {
    Write-DiagnosticLine "SCREENSHOT_SKIPPED" ("pid=$($Dialog.ProcessId);hwnd=$($Dialog.Handle);width=$Width;height=$Height;reason=invalid_bounds")
    return $null
  }

  $Bitmap = $null
  $Graphics = $null
  try {
    $Bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    # CopyFromScreen is read-only observation of the already-visible desktop pixels.
    # It does not focus, activate, click, type into, message, or otherwise mutate AE.
    $Graphics.CopyFromScreen(
      [int]$Dialog.Left,
      [int]$Dialog.Top,
      0,
      0,
      [System.Drawing.Size]::new($Width, $Height),
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )
    $ScreenshotName = "startup-dialog-pid-$($Dialog.ProcessId)-hwnd-$($Dialog.Handle).png"
    $ScreenshotPath = Join-Path $OutputDir $ScreenshotName
    $Bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-DiagnosticLine "SCREENSHOT_CAPTURED" ("pid=$($Dialog.ProcessId);hwnd=$($Dialog.Handle);width=$Width;height=$Height;path=$ScreenshotPath")
    return $ScreenshotPath
  } catch {
    Write-DiagnosticLine "SCREENSHOT_ERROR" ("pid=$($Dialog.ProcessId);hwnd=$($Dialog.Handle);error=$(Clean-DiagnosticText $_.Exception.Message)")
    return $null
  } finally {
    if ($null -ne $Graphics) { $Graphics.Dispose() }
    if ($null -ne $Bitmap) { $Bitmap.Dispose() }
  }
}

if (Test-Path $OutputPath -PathType Leaf) { Remove-Item $OutputPath -Force }
Write-DiagnosticLine "WATCH_START" ("durationSeconds=$DurationSeconds;pollMilliseconds=$PollMilliseconds;uiAutomation=$UiAutomationAvailable;screenCapture=$ScreenCaptureAvailable")

$Deadline = (Get-Date).AddSeconds($DurationSeconds)
$LastSignature = ""
$CapturedDialogHandles = @{}
$CaptureCount = 0
$MaxCaptures = 8
while ((Get-Date) -lt $Deadline) {
  $AfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  $ProcessIds = @($AfterFx | ForEach-Object { [int]$_.Id })
  if ($ProcessIds.Count -gt 0) {
    try {
      $TopLevels = @([EditFlow.StartupDialogReader]::EnumerateTopLevelForProcessIds([int[]]$ProcessIds))
      $Dialogs = @($TopLevels | Where-Object { $_.Visible -and $_.ClassName -eq "#32770" })
      foreach ($Dialog in $Dialogs) {
        $Children = @([EditFlow.StartupDialogReader]::EnumerateChildren([long]$Dialog.Handle))
        $NativeSummary = ($Children | ForEach-Object {
          "hwnd=$($_.Handle),class=$(Clean-DiagnosticText $_.ClassName),title=$(Clean-DiagnosticText $_.Title),visible=$($_.Visible),enabled=$($_.Enabled),bounds=$($_.Left),$($_.Top),$($_.Right),$($_.Bottom)"
        }) -join " | "
        $AutomationSummary = ""
        if ($UiAutomationAvailable) {
          try {
            $Root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$Dialog.Handle))
            if ($null -ne $Root) {
              $Descendants = $Root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
              )
              $AutomationParts = New-Object System.Collections.Generic.List[string]
              foreach ($Element in $Descendants) {
                try {
                  $Current = $Element.Current
                  $Name = Clean-DiagnosticText $Current.Name
                  $AutomationId = Clean-DiagnosticText $Current.AutomationId
                  $ControlType = Clean-DiagnosticText $Current.ControlType.ProgrammaticName
                  if ($Name -or $AutomationId -or $ControlType) {
                    $AutomationParts.Add("type=$ControlType,name=$Name,automationId=$AutomationId,enabled=$($Current.IsEnabled),offscreen=$($Current.IsOffscreen)")
                  }
                } catch {}
              }
              $AutomationSummary = $AutomationParts -join " | "
            }
          } catch {
            $AutomationSummary = "uiAutomationError=" + (Clean-DiagnosticText $_.Exception.Message)
          }
        }
        $Detail = "pid=$($Dialog.ProcessId);dialogHwnd=$($Dialog.Handle);title=$(Clean-DiagnosticText $Dialog.Title);bounds=$($Dialog.Left),$($Dialog.Top),$($Dialog.Right),$($Dialog.Bottom);nativeChildren=[$NativeSummary];automation=[$AutomationSummary]"
        $Signature = $Detail
        if ($Signature -ne $LastSignature) {
          Write-DiagnosticLine "VISIBLE_DIALOG" $Detail
          $LastSignature = $Signature
        }

        $CaptureKey = "$($Dialog.ProcessId):$($Dialog.Handle)"
        if ($CaptureCount -lt $MaxCaptures -and -not $CapturedDialogHandles.ContainsKey($CaptureKey)) {
          $CapturedDialogHandles[$CaptureKey] = $true
          $CaptureCount += 1
          [void](Save-ReadOnlyDialogScreenshot -Dialog $Dialog)
        }
      }
    } catch {
      Write-DiagnosticLine "WATCH_ERROR" (Clean-DiagnosticText $_.Exception.Message)
    }
  }
  Start-Sleep -Milliseconds $PollMilliseconds
}

Write-DiagnosticLine "WATCH_END" ("completed=true;capturesAttempted=$CaptureCount")
