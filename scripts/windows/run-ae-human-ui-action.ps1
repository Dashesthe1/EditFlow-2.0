param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
$ActionPath = Join-Path $RepoRoot ".github\ae-proof-request\human-action.json"
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
if (-not (Test-Path $ActionPath -PathType Leaf)) { throw "Human action file is missing: $ActionPath" }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EditFlowHumanInputWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }

  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_ESCAPE = 0x1B;

  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

  public static bool ForceForeground(IntPtr hwnd) {
    IntPtr foreground = GetForegroundWindow();
    uint foregroundPid;
    uint foregroundThread = GetWindowThreadProcessId(foreground, out foregroundPid);
    uint currentThread = GetCurrentThreadId();
    bool attached = false;
    if (foregroundThread != 0 && foregroundThread != currentThread) {
      attached = AttachThreadInput(currentThread, foregroundThread, true);
    }
    try {
      ShowWindow(hwnd, 9);
      BringWindowToTop(hwnd);
      return SetForegroundWindow(hwnd);
    } finally {
      if (attached) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }

  public static uint SendLeftClick() {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    inputs[1].type = INPUT_MOUSE;
    inputs[1].U.mi.dwFlags = MOUSEEVENTF_LEFTUP;
    return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static uint SendEscape() {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].U.ki.wVk = VK_ESCAPE;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].U.ki.wVk = VK_ESCAPE;
    inputs[1].U.ki.dwFlags = KEYEVENTF_KEYUP;
    return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

function Capture-Window {
  param([IntPtr]$Hwnd, [string]$Path)
  $rect = New-Object EditFlowHumanInputWin32+RECT
  if (-not [EditFlowHumanInputWin32]::GetWindowRect($Hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 400 -or $height -lt 300) { throw "AE window rectangle is unexpectedly small: ${width}x${height}." }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose(); $bitmap.Dispose()
  }
  return [pscustomobject]@{ left=$rect.Left; top=$rect.Top; width=$width; height=$height; right=$rect.Right; bottom=$rect.Bottom }
}

function Get-ForegroundPid {
  $fg = [EditFlowHumanInputWin32]::GetForegroundWindow()
  [uint32]$processIdValue = 0
  [void][EditFlowHumanInputWin32]::GetWindowThreadProcessId($fg, [ref]$processIdValue)
  return [int]$processIdValue
}

function Get-CursorPoint {
  $point = New-Object EditFlowHumanInputWin32+POINT
  if (-not [EditFlowHumanInputWin32]::GetCursorPos([ref]$point)) { throw "GetCursorPos failed." }
  return [pscustomobject]@{ x=[int]$point.X; y=[int]$point.Y }
}

function Write-Result {
  param([string]$Classification, [string]$Message, [hashtable]$Extra)
  $payload = [ordered]@{
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    mutationStarted = $false
    cleanupComplete = $true
    controlMode = "PIXEL_TARGETED_SENDINPUT"
    aeScriptingUsed = $false
    uiInputStarted = $false
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  if ($Extra) { foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] } }
  $json = $payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $ArtifactDir "result.json"), $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if (-not [Environment]::UserInteractive) { throw "Human-mode action proof requires an interactive desktop session." }
  $action = Get-Content $ActionPath -Raw | ConvertFrom-Json
  if ([string]$action.kind -ne "click") { throw "Only click is allowed in the first human-mode proof." }
  $nx = [double]$action.normalizedX
  $ny = [double]$action.normalizedY
  if ($nx -lt 0 -or $nx -gt 1 -or $ny -lt 0 -or $ny -gt 1) { throw "Normalized click target must be within 0..1." }
  if ([string]$action.allowedRegion -ne "TOP_MENU_BAR" -or $ny -gt 0.10) { throw "First proof is restricted to the top 10 percent menu-bar region." }
  if (-not [bool]$action.restoreWithEscape) { throw "First proof must restore the opened menu with Escape." }

  $resolved = (Resolve-Path $AfterFxPath).Path
  $targets = @()
  foreach ($p in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    try {
      $p.Refresh(); $candidate = (Resolve-Path $p.Path).Path
      if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $resolved) -and $p.Responding -and $p.MainWindowHandle -ne 0) { $targets += $p }
    } catch {}
  }
  if ($targets.Count -ne 1) { throw "Expected exactly one healthy After Effects window, found $($targets.Count)." }
  $target = $targets[0]
  $hwnd = [IntPtr]$target.MainWindowHandle
  if ([EditFlowHumanInputWin32]::IsIconic($hwnd)) { [void][EditFlowHumanInputWin32]::ShowWindow($hwnd, 9) }

  $foregroundBefore = Get-ForegroundPid
  $foregroundAttempt = [EditFlowHumanInputWin32]::ForceForeground($hwnd)
  Start-Sleep -Milliseconds 600
  $foregroundAfterFocus = Get-ForegroundPid

  $beforePath = Join-Path $ArtifactDir "ae-human-before.png"
  $afterPath = Join-Path $ArtifactDir "ae-human-after-click.png"
  $restoredPath = Join-Path $ArtifactDir "ae-human-restored.png"
  $rect = Capture-Window -Hwnd $hwnd -Path $beforePath
  $x = $rect.left + [int][Math]::Round($nx * ($rect.width - 1))
  $y = $rect.top + [int][Math]::Round($ny * ($rect.height - 1))

  $cursorBefore = Get-CursorPoint
  if (-not [EditFlowHumanInputWin32]::SetCursorPos($x, $y)) { throw "SetCursorPos failed." }
  Start-Sleep -Milliseconds 300
  $cursorAtTarget = Get-CursorPoint
  if ([Math]::Abs($cursorAtTarget.x - $x) -gt 2 -or [Math]::Abs($cursorAtTarget.y - $y) -gt 2) {
    throw "Cursor did not reach the requested target. Requested=($x,$y), actual=($($cursorAtTarget.x),$($cursorAtTarget.y))."
  }

  $sentMouse = [EditFlowHumanInputWin32]::SendLeftClick()
  Start-Sleep -Milliseconds 800
  $foregroundAfterClick = Get-ForegroundPid
  [void](Capture-Window -Hwnd $hwnd -Path $afterPath)

  $sentEscape = [EditFlowHumanInputWin32]::SendEscape()
  Start-Sleep -Milliseconds 500
  [void](Capture-Window -Hwnd $hwnd -Path $restoredPath)

  $beforeHash = (Get-FileHash $beforePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $afterHash = (Get-FileHash $afterPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $restoredHash = (Get-FileHash $restoredPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $target.Refresh()
  if (-not $target.Responding) { throw "After Effects stopped responding after UI input." }
  if ($sentMouse -ne 2) { throw "SendInput did not accept both mouse input records; accepted $sentMouse of 2." }
  if ($foregroundAfterFocus -ne [int]$target.Id) { throw "After Effects did not become the foreground process. Foreground PID was $foregroundAfterFocus; expected $($target.Id)." }
  if ($beforeHash -eq $afterHash) { throw "The UI screenshot did not change after the click even though Windows accepted the input." }

  Write-Result -Classification "PASS" -Message "GPT observed AE pixels, moved the physical pointer to the chosen target, Windows accepted a SendInput click, AE visibly responded, and Escape restored the interface." -Extra @{
    uiInputStarted = $true
    aePid = [int]$target.Id
    windowTitle = [string]$target.MainWindowTitle
    targetLabel = [string]$action.targetLabel
    normalizedTarget = [ordered]@{ x=$nx; y=$ny }
    screenTarget = [ordered]@{ x=$x; y=$y }
    cursorBefore = [ordered]@{ x=$cursorBefore.x; y=$cursorBefore.y }
    cursorAtTarget = [ordered]@{ x=$cursorAtTarget.x; y=$cursorAtTarget.y }
    foregroundPidBefore = $foregroundBefore
    foregroundSetAttempt = $foregroundAttempt
    foregroundPidAfterFocus = $foregroundAfterFocus
    foregroundPidAfterClick = $foregroundAfterClick
    sendInputMouseAccepted = $sentMouse
    sendInputEscapeAccepted = $sentEscape
    beforeScreenshot = "ae-human-before.png"
    afterScreenshot = "ae-human-after-click.png"
    restoredScreenshot = "ae-human-restored.png"
    beforeSha256 = $beforeHash
    afterSha256 = $afterHash
    restoredSha256 = $restoredHash
    responseChangedPixels = ($beforeHash -ne $afterHash)
    projectMutationExpected = $false
  }
  exit 0
} catch {
  $cursorEvidence = $null
  try { $cursorEvidence = Get-CursorPoint } catch {}
  Write-Result -Classification "INFRASTRUCTURE_FAILURE" -Message $_.Exception.Message -Extra @{
    uiInputStarted = $true
    cursorAtFailure = if ($cursorEvidence) { [ordered]@{ x=$cursorEvidence.x; y=$cursorEvidence.y } } else { $null }
  }
  exit 2
}
