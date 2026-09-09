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
public static class EditFlowHumanInputV2 {
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
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  public const uint KEYUP = 0x0002;
  public const ushort ESCAPE = 0x1B;
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static uint Click() {
    INPUT[] a = new INPUT[2];
    a[0].type = INPUT_MOUSE; a[0].U.mi.dwFlags = LEFTDOWN;
    a[1].type = INPUT_MOUSE; a[1].U.mi.dwFlags = LEFTUP;
    return SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint Escape() {
    INPUT[] a = new INPUT[2];
    a[0].type = INPUT_KEYBOARD; a[0].U.ki.wVk = ESCAPE;
    a[1].type = INPUT_KEYBOARD; a[1].U.ki.wVk = ESCAPE; a[1].U.ki.dwFlags = KEYUP;
    return SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

function Get-ForegroundProcessId {
  $fg = [EditFlowHumanInputV2]::GetForegroundWindow()
  [uint32]$processIdValue = 0
  [void][EditFlowHumanInputV2]::GetWindowThreadProcessId($fg, [ref]$processIdValue)
  return [int]$processIdValue
}

function Get-CursorPoint {
  $point = New-Object EditFlowHumanInputV2+POINT
  if (-not [EditFlowHumanInputV2]::GetCursorPos([ref]$point)) { throw "GetCursorPos failed." }
  return [pscustomobject]@{ x=[int]$point.X; y=[int]$point.Y }
}

function Capture-Window {
  param([IntPtr]$Hwnd, [string]$Path)
  $rect = New-Object EditFlowHumanInputV2+RECT
  if (-not [EditFlowHumanInputV2]::GetWindowRect($Hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  return [pscustomobject]@{ left=$rect.Left; top=$rect.Top; width=$width; height=$height }
}

function Write-Result {
  param([string]$Classification, [string]$Message, [hashtable]$Extra)
  $payload = [ordered]@{
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    mutationStarted = $false
    cleanupComplete = $true
    controlMode = "PIXEL_TARGETED_SENDINPUT_V2"
    aeScriptingUsed = $false
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  if ($Extra) { foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] } }
  [System.IO.File]::WriteAllText((Join-Path $ArtifactDir "result.json"), (($payload | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if (-not [Environment]::UserInteractive) { throw "Interactive desktop required." }
  $action = Get-Content $ActionPath -Raw | ConvertFrom-Json
  $nx = [double]$action.normalizedX; $ny = [double]$action.normalizedY
  if ([string]$action.kind -ne "click" -or [string]$action.allowedRegion -ne "TOP_MENU_BAR" -or $ny -gt 0.10) { throw "Invalid first-proof action." }

  $resolved = (Resolve-Path $AfterFxPath).Path
  $targets = @()
  foreach ($p in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    try {
      $p.Refresh(); $candidate = (Resolve-Path $p.Path).Path
      if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $resolved) -and $p.Responding -and $p.MainWindowHandle -ne 0) { $targets += $p }
    } catch {}
  }
  if ($targets.Count -ne 1) { throw "Expected one healthy AE window; found $($targets.Count)." }
  $target = $targets[0]; $hwnd = [IntPtr]$target.MainWindowHandle
  if ([EditFlowHumanInputV2]::IsIconic($hwnd)) { [void][EditFlowHumanInputV2]::ShowWindow($hwnd, 9) }

  $foregroundBefore = Get-ForegroundProcessId
  $setForegroundReturned = [EditFlowHumanInputV2]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 500
  $foregroundAfter = Get-ForegroundProcessId

  $before = Join-Path $ArtifactDir "before.png"
  $after = Join-Path $ArtifactDir "after-click.png"
  $restored = Join-Path $ArtifactDir "restored.png"
  $rect = Capture-Window $hwnd $before
  $x = $rect.left + [int][Math]::Round($nx * ($rect.width - 1))
  $y = $rect.top + [int][Math]::Round($ny * ($rect.height - 1))
  $cursorBefore = Get-CursorPoint
  if (-not [EditFlowHumanInputV2]::SetCursorPos($x, $y)) { throw "SetCursorPos failed." }
  Start-Sleep -Milliseconds 250
  $cursorAtTarget = Get-CursorPoint
  $sentClick = [EditFlowHumanInputV2]::Click()
  Start-Sleep -Milliseconds 750
  $foregroundAfterClick = Get-ForegroundProcessId
  [void](Capture-Window $hwnd $after)
  $sentEscape = [EditFlowHumanInputV2]::Escape()
  Start-Sleep -Milliseconds 450
  [void](Capture-Window $hwnd $restored)

  $beforeHash = (Get-FileHash $before -Algorithm SHA256).Hash.ToLowerInvariant()
  $afterHash = (Get-FileHash $after -Algorithm SHA256).Hash.ToLowerInvariant()
  $restoredHash = (Get-FileHash $restored -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sentClick -ne 2) { throw "SendInput accepted $sentClick of 2 mouse events." }
  if ($foregroundAfter -ne [int]$target.Id) { throw "AE was not foreground before click: $foregroundAfter vs $($target.Id)." }
  if ($beforeHash -eq $afterHash) { throw "AE pixels did not change after accepted SendInput click." }

  Write-Result "PASS" "GPT-selected pixel target visibly responded to real Windows SendInput mouse control and was restored with Escape." @{
    aePid=[int]$target.Id; targetLabel=[string]$action.targetLabel;
    foregroundPidBefore=$foregroundBefore; setForegroundReturned=$setForegroundReturned; foregroundPidAfter=$foregroundAfter; foregroundPidAfterClick=$foregroundAfterClick;
    requestedTarget=[ordered]@{x=$x;y=$y}; cursorBefore=[ordered]@{x=$cursorBefore.x;y=$cursorBefore.y}; cursorAtTarget=[ordered]@{x=$cursorAtTarget.x;y=$cursorAtTarget.y};
    sendInputClickAccepted=$sentClick; sendInputEscapeAccepted=$sentEscape;
    beforeScreenshot="before.png"; afterScreenshot="after-click.png"; restoredScreenshot="restored.png";
    beforeSha256=$beforeHash; afterSha256=$afterHash; restoredSha256=$restoredHash; responseChangedPixels=$true
  }
  exit 0
} catch {
  $cursor = $null; try { $cursor = Get-CursorPoint } catch {}
  Write-Result "INFRASTRUCTURE_FAILURE" $_.Exception.Message @{
    cursorAtFailure = if ($cursor) { [ordered]@{x=$cursor.x;y=$cursor.y} } else { $null }
  }
  exit 2
}
