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

function ConvertTo-ExactLogText {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t]+", " ").Trim())
}

function Get-VisualScriptErrorMessage {
  param([AllowNull()][string]$Value)
  $Text = ConvertTo-ExactLogText $Value
  if (-not $Text) { return "" }
  $Match = [regex]::Match($Text, '(?i)\bunable\s+to\s+execute\s+script\b')
  if (-not $Match.Success) { return "" }
  $Message = $Text.Substring($Match.Index)
  return ([regex]::Replace($Message, '(?i)\s+(?:OK|0K|Close)\s*$', '').Trim())
}

# This native helper is deliberately narrow. It can enumerate/capture AfterFX-owned
# windows, invoke a native Button control, or send Enter only to a supervisor-confirmed
# modal dialog. It exposes no arbitrary coordinates, text typing, shell execution, or
# generic message-send surface to callers.
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

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint BM_CLICK = 0x00F5;
    private const uint WM_KEYDOWN = 0x0100;
    private const uint WM_KEYUP = 0x0101;
    private const int VK_RETURN = 0x0D;
    private const uint PW_RENDERFULLCONTENT = 0x00000002;

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

    public static int[] GetWindowPixelSize(long windowHandle) {
      var hWnd = new IntPtr(windowHandle);
      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return new int[] { 0, 0 };
      var scale = Math.Max(1.0, GetDpiForWindow(hWnd) / 96.0);
      var width = (int)Math.Ceiling(Math.Max(0, rect.Right - rect.Left) * scale);
      var height = (int)Math.Ceiling(Math.Max(0, rect.Bottom - rect.Top) * scale);
      return new int[] { width, height };
    }

    public static bool PrintWindowToHdc(long windowHandle, long hdcHandle) {
      return PrintWindow(new IntPtr(windowHandle), new IntPtr(hdcHandle), PW_RENDERFULLCONTENT);
    }

    public static void InvokeDialogEnter(long dialogHandle) {
      var dialog = new IntPtr(dialogHandle);
      SetForegroundWindow(dialog);
      SetActiveWindow(dialog);
      SendMessage(dialog, WM_KEYDOWN, new IntPtr(VK_RETURN), IntPtr.Zero);
      SendMessage(dialog, WM_KEYUP, new IntPtr(VK_RETURN), IntPtr.Zero);
    }

    public static void InvokeButton(long dialogHandle, long buttonHandle) {
      var dialog = new IntPtr(dialogHandle);
      var button = new IntPtr(buttonHandle);
      SetForegroundWindow(dialog);
      SetActiveWindow(dialog);
      SendMessage(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    }

    public static void InvokeContinueButton(long dialogHandle, long buttonHandle) {
      InvokeButton(dialogHandle, buttonHandle);
    }
  }
}
"@
}

$OcrAvailable = $false
$OcrAwaitMethod = $null
$OcrEngine = $null
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
  $OcrAwaitMethod = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  })[0]
  $OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  $OcrAvailable = ($null -ne $OcrAwaitMethod -and $null -ne $OcrEngine)
} catch {
  Write-SupervisorLog "OCR_UNAVAILABLE" (ConvertTo-SingleLine $_.Exception.Message)
}

function Invoke-WinRtAwait {
  param([Parameter(Mandatory = $true)]$Operation, [Parameter(Mandatory = $true)][Type]$ResultType)
  $GenericMethod = $OcrAwaitMethod.MakeGenericMethod($ResultType)
  $Task = $GenericMethod.Invoke($null, @($Operation))
  $Task.Wait()
  return $Task.Result
}

function Read-OcrImageText {
  param([Parameter(Mandatory = $true)][string]$ImagePath)
  $Stream = $null
  $Bitmap = $null
  try {
    $File = Invoke-WinRtAwait ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $Stream = Invoke-WinRtAwait ($File.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $Decoder = Invoke-WinRtAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($Stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $Bitmap = Invoke-WinRtAwait ($Decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $Result = Invoke-WinRtAwait ($OcrEngine.RecognizeAsync($Bitmap)) ([Windows.Media.Ocr.OcrResult])
    return (ConvertTo-ExactLogText ([string]$Result.Text))
  } finally {
    try { if ($Bitmap) { $Bitmap.Dispose() } } catch {}
    try { if ($Stream) { $Stream.Dispose() } } catch {}
  }
}

function Get-DialogOcrText {
  param([Parameter(Mandatory = $true)][long]$WindowHandle)
  if (-not $OcrAvailable) { return "" }

  $Size = [EditFlow.AeHostSupervisorNative]::GetWindowPixelSize($WindowHandle)
  $Width = [int]$Size[0]
  $Height = [int]$Size[1]
  if ($Width -lt 100 -or $Height -lt 80 -or $Width -gt 4096 -or $Height -gt 2160) {
    Write-SupervisorLog "OCR_CAPTURE_REFUSED" ("hwnd=$WindowHandle;width=$Width;height=$Height")
    return ""
  }

  $ImagePath = Join-Path ([IO.Path]::GetTempPath()) ("editflow-ae-dialog-" + [Guid]::NewGuid().ToString("N") + ".png")
  $Bitmap = $null
  $Graphics = $null
  $Hdc = [IntPtr]::Zero
  try {
    $Bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $Hdc = $Graphics.GetHdc()
    $Printed = [EditFlow.AeHostSupervisorNative]::PrintWindowToHdc($WindowHandle, $Hdc.ToInt64())
    $Graphics.ReleaseHdc($Hdc)
    $Hdc = [IntPtr]::Zero
    if (-not $Printed) { throw "PrintWindow returned false." }
    $Bitmap.Save($ImagePath, [System.Drawing.Imaging.ImageFormat]::Png)
    return (Read-OcrImageText -ImagePath $ImagePath)
  } catch {
    Write-SupervisorLog "OCR_CAPTURE_ERROR" ("hwnd=$WindowHandle;error=" + (ConvertTo-SingleLine $_.Exception.Message))
    return ""
  } finally {
    if ($Hdc -ne [IntPtr]::Zero -and $Graphics) { try { $Graphics.ReleaseHdc($Hdc) } catch {} }
    if ($Graphics) { try { $Graphics.Dispose() } catch {} }
    if ($Bitmap) { try { $Bitmap.Dispose() } catch {} }
    Remove-Item $ImagePath -Force -ErrorAction SilentlyContinue
  }
}

$UiaAvailable = $false
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $UiaAvailable = $true
} catch {
  Write-SupervisorLog "UIA_UNAVAILABLE" (ConvertTo-SingleLine $_.Exception.Message)
}

function Get-UiaEntries {
  param([Parameter(Mandatory = $true)][long]$WindowHandle)
  if (-not $UiaAvailable) { return @() }

  $Entries = @()
  try {
    $Root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
    if ($null -eq $Root) { return @() }
    $Elements = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Subtree,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    for ($Index = 0; $Index -lt $Elements.Count; $Index++) {
      $Element = $Elements.Item($Index)
      try {
        $Entries += [pscustomobject]@{
          Element = $Element
          Name = [string]$Element.Current.Name
          AutomationId = [string]$Element.Current.AutomationId
          ClassName = [string]$Element.Current.ClassName
          ControlType = [string]$Element.Current.ControlType.ProgrammaticName
          Enabled = [bool]$Element.Current.IsEnabled
          Offscreen = [bool]$Element.Current.IsOffscreen
          NativeWindowHandle = [int]$Element.Current.NativeWindowHandle
        }
      } catch {}
    }
  } catch {
    Write-SupervisorLog "UIA_ENUM_ERROR" ("hwnd=$WindowHandle;error=" + (ConvertTo-SingleLine $_.Exception.Message))
  }
  return @($Entries)
}

function Test-UiaInvokable {
  param([Parameter(Mandatory = $true)]$Element)
  try {
    $Pattern = $null
    return $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$Pattern)
  } catch {
    return $false
  }
}

function Invoke-UiaElement {
  param([Parameter(Mandatory = $true)]$Element)
  $Pattern = $null
  if (-not $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$Pattern)) {
    throw "UI Automation element does not expose InvokePattern."
  }
  ([System.Windows.Automation.InvokePattern]$Pattern).Invoke()
}

$SeenDialogs = @{}
$DialogOcrTexts = @{}
$InvokedDialogs = @{}
$InvocationCount = 0
$ScriptErrorDismissalCount = 0
$Deadline = (Get-Date).AddSeconds($WatchSeconds)
Write-SupervisorLog "START" ("afterFx=$ResolvedAfterFxPath;watchSeconds=$WatchSeconds;pollMilliseconds=$PollMilliseconds;uia=$UiaAvailable;ocr=$OcrAvailable")

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
      $UiaEntries = @(Get-UiaEntries -WindowHandle $Window.Handle)

      if (-not $SeenDialogs.ContainsKey($HandleKey)) {
        $SeenDialogs[$HandleKey] = $true
        Write-SupervisorLog "DIALOG" ("pid=$($Window.ProcessId);hwnd=$($Window.Handle);title=$(ConvertTo-SingleLine $Window.Title);childCount=$($Children.Count);uiaCount=$($UiaEntries.Count)")
        foreach ($Child in $Children) {
          Write-SupervisorLog "CHILD" ("pid=$($Child.ProcessId);hwnd=$($Child.Handle);visible=$($Child.Visible);enabled=$($Child.Enabled);class=$(ConvertTo-SingleLine $Child.ClassName);title=$(ConvertTo-SingleLine $Child.Title)")
        }
        foreach ($Entry in $UiaEntries) {
          if (-not $Entry.Name -and -not $Entry.AutomationId) { continue }
          Write-SupervisorLog "UIA" ("name=$(ConvertTo-SingleLine $Entry.Name);automationId=$(ConvertTo-SingleLine $Entry.AutomationId);controlType=$(ConvertTo-SingleLine $Entry.ControlType);class=$(ConvertTo-SingleLine $Entry.ClassName);enabled=$($Entry.Enabled);offscreen=$($Entry.Offscreen);nativeHwnd=$($Entry.NativeWindowHandle)")
        }
        $DialogOcrTexts[$HandleKey] = Get-DialogOcrText -WindowHandle $Window.Handle
        if ($DialogOcrTexts[$HandleKey]) {
          Write-SupervisorLog "OCR" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);text=$(ConvertTo-ExactLogText $DialogOcrTexts[$HandleKey])")
        }
      }

      if ($InvokedDialogs.ContainsKey($HandleKey)) { continue }

      $NativeContext = ((@($Window.Title) + @($Children | ForEach-Object { $_.Title })) -join " ")
      $UiaContext = (($UiaEntries | ForEach-Object { $_.Name }) -join " ")
      $VisualContext = if ($DialogOcrTexts.ContainsKey($HandleKey)) { [string]$DialogOcrTexts[$HandleKey] } else { "" }
      $ContextText = ($NativeContext + " " + $UiaContext + " " + $VisualContext)
      $RecoveryContext = $ContextText -match '(?i)(crash(?:ed)?|repair|recover(?:y|ed|ing)?|restore|previous\s+session|closed\s+unexpectedly|unexpected(?:ly)?\s+(?:quit|close|shutdown)|did\s+not\s+shut\s+down|safe\s+mode)'
      $ScriptErrorContext = (
        ($ContextText -match '(?i)\bunable\s+to\s+execute\s+script\b') -or
        ($ContextText -match '(?i)\b(?:jsx|extendscript|javascript)\b.*\b(?:syntax|compile|parser|runtime)\s+error\b')
      )

      $NativeScriptAckButtons = @($Children | Where-Object {
        $Label = (($_.Title -replace "&", "").Trim())
        $_.Visible -and $_.Enabled -and $_.ClassName -eq "Button" -and ($Label -ieq "OK" -or $Label -ieq "Close")
      })

      $UiaScriptAckButtons = @($UiaEntries | Where-Object {
        $Label = (($_.Name -replace "&", "").Trim())
        $_.Enabled -and -not $_.Offscreen -and ($Label -ieq "OK" -or $Label -ieq "Close") -and
        (($_.ControlType -eq "ControlType.Button") -or (Test-UiaInvokable -Element $_.Element))
      })

      $VisualErrorMessage = Get-VisualScriptErrorMessage $VisualContext
      $VisualScriptErrorConfirmed = [bool]$VisualErrorMessage
      $VisualAckMatches = if ($VisualContext) {
        @([regex]::Matches($VisualContext, '(?i)(?<![A-Za-z0-9])(?:OK|0K|Close)(?![A-Za-z0-9])'))
      } else { @() }
      $VisualUnsafeButtonMatches = if ($VisualContext) {
        @([regex]::Matches($VisualContext, '(?i)\b(?:Cancel|Yes|No|Retry|Ignore|Abort|Continue|Save)\b'))
      } else { @() }
      $VisualContinueMatches = if ($VisualContext) {
        @([regex]::Matches($VisualContext, '(?i)(?<![A-Za-z0-9])Continu\s*e(?![A-Za-z0-9])'))
      } else { @() }
      $VisualRecoveryEnterSafe = (
        $RecoveryContext -and
        $VisualContinueMatches.Count -eq 1 -and
        (
          ($VisualContext -match '(?i)\bstartup\s+options\b' -and $VisualContext -match '(?i)\bhow\s+would\s+you\s+like\s+to\s+proceed\b') -or
          ($VisualContext -match '(?i)\bcrash\s+repair\s+options\b' -and $VisualContext -match '(?i)\bdetected\s+a\s+crash\b' -and $VisualContext -match '(?i)\bsafe\s+mode\b')
        )
      )

      $NativeContinueButtons = @($Children | Where-Object {
        $_.Visible -and $_.Enabled -and $_.ClassName -eq "Button" -and ((($_.Title -replace "&", "").Trim()) -ieq "Continue")
      })

      $UiaContinueButtons = @($UiaEntries | Where-Object {
        $_.Enabled -and -not $_.Offscreen -and ((($_.Name -replace "&", "").Trim()) -ieq "Continue") -and
        (($_.ControlType -eq "ControlType.Button") -or (Test-UiaInvokable -Element $_.Element))
      })

      if ($ScriptErrorContext) {
        $LoggedScriptMessage = if ($VisualErrorMessage) { $VisualErrorMessage } else { ConvertTo-ExactLogText $ContextText }
        Write-SupervisorLog "SCRIPT_ERROR_DETECTED" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);message=$LoggedScriptMessage")
        if ($NativeScriptAckButtons.Count -eq 1) {
          $Button = $NativeScriptAckButtons[0]
          $InvokedDialogs[$HandleKey] = $true
          Write-SupervisorLog "DISMISS_SCRIPT_ERROR_NATIVE" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);buttonHwnd=$($Button.Handle);label=$(ConvertTo-SingleLine $Button.Title)")
          [EditFlow.AeHostSupervisorNative]::InvokeButton($Window.Handle, $Button.Handle)
          $InvocationCount += 1
          $ScriptErrorDismissalCount += 1
          Start-Sleep -Milliseconds 250
        } elseif ($NativeScriptAckButtons.Count -eq 0 -and $UiaScriptAckButtons.Count -eq 1) {
          $Button = $UiaScriptAckButtons[0]
          $InvokedDialogs[$HandleKey] = $true
          Write-SupervisorLog "DISMISS_SCRIPT_ERROR_UIA" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);automationId=$(ConvertTo-SingleLine $Button.AutomationId);label=$(ConvertTo-SingleLine $Button.Name)")
          try {
            Invoke-UiaElement -Element $Button.Element
            $InvocationCount += 1
            $ScriptErrorDismissalCount += 1
            Start-Sleep -Milliseconds 250
          } catch {
            Write-SupervisorLog "SCRIPT_ERROR_UIA_INVOKE_ERROR" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);error=" + (ConvertTo-SingleLine $_.Exception.Message))
          }
        } elseif ($VisualScriptErrorConfirmed -and $VisualAckMatches.Count -eq 1 -and $VisualUnsafeButtonMatches.Count -eq 0) {
          $AckLabel = [string]$VisualAckMatches[0].Value
          $InvokedDialogs[$HandleKey] = $true
          Write-SupervisorLog "DISMISS_SCRIPT_ERROR_OCR_ENTER" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);label=$AckLabel;message=$LoggedScriptMessage")
          [EditFlow.AeHostSupervisorNative]::InvokeDialogEnter($Window.Handle)
          $InvocationCount += 1
          $ScriptErrorDismissalCount += 1
          Start-Sleep -Milliseconds 250
        } else {
          Write-SupervisorLog "REFUSED_SCRIPT_ERROR_DISMISS" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);nativeAck=$($NativeScriptAckButtons.Count);uiaAck=$($UiaScriptAckButtons.Count);visualAck=$($VisualAckMatches.Count);visualUnsafe=$($VisualUnsafeButtonMatches.Count);visualConfirmed=$VisualScriptErrorConfirmed")
        }
        continue
      }

      if ($RecoveryContext -and $NativeContinueButtons.Count -eq 1) {
        $Button = $NativeContinueButtons[0]
        $InvokedDialogs[$HandleKey] = $true
        Write-SupervisorLog "INVOKE_CONTINUE_NATIVE" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);buttonHwnd=$($Button.Handle);contextMatched=true")
        [EditFlow.AeHostSupervisorNative]::InvokeContinueButton($Window.Handle, $Button.Handle)
        $InvocationCount += 1
        Start-Sleep -Milliseconds 750
      } elseif ($RecoveryContext -and $NativeContinueButtons.Count -eq 0 -and $UiaContinueButtons.Count -eq 1) {
        $Button = $UiaContinueButtons[0]
        $InvokedDialogs[$HandleKey] = $true
        Write-SupervisorLog "INVOKE_CONTINUE_UIA" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);automationId=$(ConvertTo-SingleLine $Button.AutomationId);controlType=$(ConvertTo-SingleLine $Button.ControlType);contextMatched=true")
        try {
          Invoke-UiaElement -Element $Button.Element
          $InvocationCount += 1
          Start-Sleep -Milliseconds 750
        } catch {
          Write-SupervisorLog "UIA_INVOKE_ERROR" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);error=" + (ConvertTo-SingleLine $_.Exception.Message))
        }
      } elseif ($RecoveryContext -and $NativeContinueButtons.Count -eq 0 -and $UiaContinueButtons.Count -eq 0 -and $VisualRecoveryEnterSafe) {
        $InvokedDialogs[$HandleKey] = $true
        Write-SupervisorLog "INVOKE_CONTINUE_OCR_ENTER" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);visualContinue=$($VisualContinueMatches.Count);contextMatched=true")
        [EditFlow.AeHostSupervisorNative]::InvokeDialogEnter($Window.Handle)
        $InvocationCount += 1
        Start-Sleep -Milliseconds 750
      } elseif (($NativeContinueButtons.Count + $UiaContinueButtons.Count + $VisualContinueMatches.Count) -gt 0) {
        Write-SupervisorLog "REFUSED_CONTINUE" ("pid=$($Window.ProcessId);dialogHwnd=$($Window.Handle);nativeContinue=$($NativeContinueButtons.Count);uiaContinue=$($UiaContinueButtons.Count);visualContinue=$($VisualContinueMatches.Count);recoveryContext=$RecoveryContext;visualRecoveryEnterSafe=$VisualRecoveryEnterSafe")
      }
    }
  }

  Start-Sleep -Milliseconds $PollMilliseconds
}

Write-SupervisorLog "END" ("invocationCount=$InvocationCount;scriptErrorDismissalCount=$ScriptErrorDismissalCount;seenDialogs=$($SeenDialogs.Count)")
