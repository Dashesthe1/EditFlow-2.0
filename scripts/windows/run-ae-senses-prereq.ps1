param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EFSensesWin32 {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
function Get-CommandPath([string]$Name) {
  try { $c = Get-Command $Name -ErrorAction Stop | Select-Object -First 1; return [string]$c.Source } catch { return $null }
}
function Capture-Window([IntPtr]$Handle,[string]$Path) {
  $r = New-Object EFSensesWin32+RECT
  if (-not [EFSensesWin32]::GetWindowRect($Handle,[ref]$r)) { throw "GetWindowRect failed." }
  $w = $r.Right-$r.Left; $h = $r.Bottom-$r.Top
  if ($w -le 0 -or $h -le 0) { throw "AE window bounds are invalid." }
  $bmp = New-Object System.Drawing.Bitmap($w,$h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($r.Left,$r.Top,0,0,(New-Object System.Drawing.Size($w,$h))); $bmp.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $g.Dispose(); $bmp.Dispose() }
  return [ordered]@{ left=$r.Left; top=$r.Top; width=$w; height=$h }
}
function Write-Result([string]$Classification,[string]$Message,[hashtable]$Extra) {
  $o=[ordered]@{classification=$Classification;ok=($Classification-eq'PASS');message=$Message;mutationStarted=$false;cleanupComplete=$true;proofKind='AE_SENSES_PREREQ'}
  foreach($k in $Extra.Keys){$o[$k]=$Extra[$k]}
  [IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
}
try {
  $resolved=(Resolve-Path $AfterFxPath).Path
  $targets=@()
  foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){
    try{$p.Refresh(); if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$resolved)-and$p.Responding-and$p.MainWindowHandle-ne0){$targets+=$p}}catch{}
  }
  if($targets.Count-ne1){throw "Expected one healthy AE target, found $($targets.Count)."}
  $t=$targets[0]
  $screenPath=Join-Path $ArtifactDir 'ae-window.png'
  $bounds=Capture-Window ([IntPtr]$t.MainWindowHandle) $screenPath
  $tools=[ordered]@{
    winapp=Get-CommandPath 'winapp'
    winget=Get-CommandPath 'winget'
    git=Get-CommandPath 'git'
    msbuild=Get-CommandPath 'msbuild'
    cl=Get-CommandPath 'cl'
    node=Get-CommandPath 'node'
    npm=Get-CommandPath 'npm'
    python=Get-CommandPath 'python'
    ffmpeg=Get-CommandPath 'ffmpeg'
  }
  $uiTree=$null
  $winappShot=$null
  if($tools.winapp){
    $uiTree=Join-Path $ArtifactDir 'ae-ui-tree.txt'
    $winappShot=Join-Path $ArtifactDir 'ae-window-winapp.png'
    try { & $tools.winapp ui inspect -a ([string]$t.Id) --depth 5 2>&1 | Out-File $uiTree -Encoding utf8 } catch { $_ | Out-File $uiTree -Encoding utf8 }
    try { & $tools.winapp ui screenshot -a ([string]$t.Id) --output $winappShot 2>&1 | Out-File (Join-Path $ArtifactDir 'winapp-screenshot.log') -Encoding utf8 } catch { $_ | Out-File (Join-Path $ArtifactDir 'winapp-screenshot.log') -Encoding utf8 }
  }
  $extra=@{aePid=[int]$t.Id;aeWindowTitle=[string]$t.MainWindowTitle;interactive=[Environment]::UserInteractive;windowBounds=$bounds;tools=$tools;screenCaptureExists=(Test-Path $screenPath);screenCaptureBytes=(Get-Item $screenPath).Length;winappUiTreeExists=($uiTree-and(Test-Path $uiTree));winappScreenshotExists=($winappShot-and(Test-Path $winappShot));os=[Environment]::OSVersion.VersionString;powershell=$PSVersionTable.PSVersion.ToString()}
  Write-Result 'PASS' 'Captured the live AE window and inventoried prerequisites for UI and process-audio sensing.' $extra
  exit 0
}catch{ Write-Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{}; exit 2 }
