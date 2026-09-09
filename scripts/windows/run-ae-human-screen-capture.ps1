param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EditFlowHumanVisionWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Write-Result {
  param([string]$Classification, [string]$Message, [hashtable]$Extra)
  $payload = [ordered]@{
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    mutationStarted = $false
    cleanupComplete = $true
    controlMode = "PIXEL_OBSERVATION_ONLY"
    aeScriptingUsed = $false
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  if ($Extra) { foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] } }
  $json = $payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $ArtifactDir "result.json"), $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if (-not [Environment]::UserInteractive) { throw "Human-mode proof requires an interactive desktop session." }
  $resolved = (Resolve-Path $AfterFxPath).Path
  $targets = @()
  foreach ($p in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    try {
      $p.Refresh()
      $candidate = (Resolve-Path $p.Path).Path
      if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $resolved) -and $p.Responding -and $p.MainWindowHandle -ne 0) {
        $targets += $p
      }
    } catch {}
  }
  if ($targets.Count -ne 1) { throw "Expected exactly one healthy After Effects window, found $($targets.Count)." }

  $target = $targets[0]
  $hwnd = [IntPtr]$target.MainWindowHandle
  if ([EditFlowHumanVisionWin32]::IsIconic($hwnd)) { [void][EditFlowHumanVisionWin32]::ShowWindow($hwnd, 9) }
  [void][EditFlowHumanVisionWin32]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 700

  $rect = New-Object EditFlowHumanVisionWin32+RECT
  if (-not [EditFlowHumanVisionWin32]::GetWindowRect($hwnd, [ref]$rect)) { throw "GetWindowRect failed." }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 400 -or $height -lt 300) { throw "AE window rectangle is unexpectedly small: ${width}x${height}." }

  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $screenshot = Join-Path $ArtifactDir "ae-window-before.png"
    $bitmap.Save($screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  Write-Result -Classification "PASS" -Message "Captured the live After Effects window through desktop pixels without AE scripting or project mutation." -Extra @{
    aePid = [int]$target.Id
    windowTitle = [string]$target.MainWindowTitle
    windowRect = [ordered]@{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom; width=$width; height=$height }
    screenshot = "ae-window-before.png"
  }
  exit 0
} catch {
  Write-Result -Classification "INFRASTRUCTURE_FAILURE" -Message $_.Exception.Message -Extra @{}
  exit 2
}
