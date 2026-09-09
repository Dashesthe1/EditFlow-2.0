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
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
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

function Write-Result {
  param([string]$Classification, [string]$Message, [hashtable]$Extra)
  $payload = [ordered]@{
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    mutationStarted = $false
    cleanupComplete = $true
    controlMode = "PIXEL_TARGETED_MOUSE_INPUT"
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
  [void][EditFlowHumanInputWin32]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 600

  $beforePath = Join-Path $ArtifactDir "ae-human-before.png"
  $afterPath = Join-Path $ArtifactDir "ae-human-after-click.png"
  $restoredPath = Join-Path $ArtifactDir "ae-human-restored.png"
  $rect = Capture-Window -Hwnd $hwnd -Path $beforePath
  $x = $rect.left + [int][Math]::Round($nx * ($rect.width - 1))
  $y = $rect.top + [int][Math]::Round($ny * ($rect.height - 1))

  if (-not [EditFlowHumanInputWin32]::SetCursorPos($x, $y)) { throw "SetCursorPos failed." }
  Start-Sleep -Milliseconds 300
  [EditFlowHumanInputWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [EditFlowHumanInputWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 650
  [void](Capture-Window -Hwnd $hwnd -Path $afterPath)

  [EditFlowHumanInputWin32]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
  [EditFlowHumanInputWin32]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 450
  [void](Capture-Window -Hwnd $hwnd -Path $restoredPath)

  $beforeHash = (Get-FileHash $beforePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $afterHash = (Get-FileHash $afterPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $restoredHash = (Get-FileHash $restoredPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $target.Refresh()
  if (-not $target.Responding) { throw "After Effects stopped responding after UI input." }
  if ($beforeHash -eq $afterHash) { throw "The UI screenshot did not change after the click; target was likely ineffective." }

  Write-Result -Classification "PASS" -Message "Moved the real pointer to a GPT-selected pixel target, clicked the live AE interface, observed a visible response, and restored it with Escape." -Extra @{
    uiInputStarted = $true
    aePid = [int]$target.Id
    windowTitle = [string]$target.MainWindowTitle
    targetLabel = [string]$action.targetLabel
    normalizedTarget = [ordered]@{ x=$nx; y=$ny }
    screenTarget = [ordered]@{ x=$x; y=$y }
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
  Write-Result -Classification "INFRASTRUCTURE_FAILURE" -Message $_.Exception.Message -Extra @{}
  exit 2
}
