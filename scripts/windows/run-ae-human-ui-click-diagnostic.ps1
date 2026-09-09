param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
$ActionPath = Join-Path $RepoRoot ".github\ae-proof-request\human-action.json"
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EFDIAG {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U data; }
 [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MI mi; }
 [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr extra; }
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] input, int size);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 public static uint Click(){ var a=new INPUT[2]; a[0].type=0; a[0].data.mi.dwFlags=0x0002; a[1].type=0; a[1].data.mi.dwFlags=0x0004; return SendInput(2,a,Marshal.SizeOf(typeof(INPUT))); }
}
"@
function ForegroundPid { $h=[EFDIAG]::GetForegroundWindow(); [uint32]$v=0; [void][EFDIAG]::GetWindowThreadProcessId($h,[ref]$v); return [int]$v }
function CursorPoint { $p=New-Object EFDIAG+POINT; [void][EFDIAG]::GetCursorPos([ref]$p); return [pscustomobject]@{x=$p.X;y=$p.Y} }
function Capture([IntPtr]$h,[string]$p){ $r=New-Object EFDIAG+RECT; [void][EFDIAG]::GetWindowRect($h,[ref]$r); $w=$r.Right-$r.Left; $ht=$r.Bottom-$r.Top; $b=New-Object System.Drawing.Bitmap($w,$ht); $g=[System.Drawing.Graphics]::FromImage($b); try{$g.CopyFromScreen($r.Left,$r.Top,0,0,(New-Object System.Drawing.Size($w,$ht)));$b.Save($p,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$b.Dispose()}; return [pscustomobject]@{left=$r.Left;top=$r.Top;width=$w;height=$ht} }
function Result($classification,$message,$extra){ $o=[ordered]@{classification=$classification;ok=($classification-eq'PASS');message=$message;mutationStarted=$false;cleanupComplete=$true;controlMode='PIXEL_SENDINPUT_DIAGNOSTIC';aeScriptingUsed=$false}; foreach($k in $extra.Keys){$o[$k]=$extra[$k]}; [IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 8)+[Environment]::NewLine)) }
try{
 $a=Get-Content $ActionPath -Raw|ConvertFrom-Json; $resolved=(Resolve-Path $AfterFxPath).Path; $targets=@(); foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh(); if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$resolved)-and$p.Responding-and$p.MainWindowHandle-ne0){$targets+=$p}}catch{}}
 if($targets.Count-ne1){throw "Expected one AE target, found $($targets.Count)."}; $t=$targets[0]; $h=[IntPtr]$t.MainWindowHandle
 $fg0=ForegroundPid; $setfg=[EFDIAG]::SetForegroundWindow($h); Start-Sleep -Milliseconds 500; $fg1=ForegroundPid
 $before=Join-Path $ArtifactDir 'before.png'; $after=Join-Path $ArtifactDir 'after.png'; $r=Capture $h $before
 $x=$r.left+[int][Math]::Round(([double]$a.normalizedX)*($r.width-1)); $y=$r.top+[int][Math]::Round(([double]$a.normalizedY)*($r.height-1)); $c0=CursorPoint; if(-not[EFDIAG]::SetCursorPos($x,$y)){throw 'SetCursorPos failed'}; Start-Sleep -Milliseconds 250; $c1=CursorPoint
 $sent=[EFDIAG]::Click(); $err=[Runtime.InteropServices.Marshal]::GetLastWin32Error(); Start-Sleep -Milliseconds 800; $fg2=ForegroundPid; [void](Capture $h $after)
 $bh=(Get-FileHash $before -Algorithm SHA256).Hash.ToLowerInvariant(); $ah=(Get-FileHash $after -Algorithm SHA256).Hash.ToLowerInvariant(); $changed=$bh-ne$ah
 $extra=@{aePid=[int]$t.Id;foregroundPidBefore=$fg0;setForegroundReturned=$setfg;foregroundPidBeforeClick=$fg1;foregroundPidAfterClick=$fg2;cursorBefore=[ordered]@{x=$c0.x;y=$c0.y};cursorAtTarget=[ordered]@{x=$c1.x;y=$c1.y};requestedTarget=[ordered]@{x=$x;y=$y};sendInputAccepted=$sent;sendInputLastError=$err;beforeSha256=$bh;afterSha256=$ah;responseChangedPixels=$changed;beforeScreenshot='before.png';afterScreenshot='after.png'}
 if($sent-ne2){Result 'INFRASTRUCTURE_FAILURE' "SendInput accepted $sent of 2 events." $extra; exit 2}; if($fg1-ne[int]$t.Id){Result 'INFRASTRUCTURE_FAILURE' "AE was not foreground before click." $extra; exit 2}; if(-not$changed){Result 'INFRASTRUCTURE_FAILURE' "Windows accepted the click but AE pixels did not change." $extra; exit 2}; Result 'PASS' 'Real SendInput click visibly changed AE at the GPT-selected pixel target.' $extra; exit 0
}catch{ Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{}; exit 2 }
