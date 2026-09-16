param(
  [Parameter(Mandatory=$true)][ValidateSet('HIDE','RESTORE')][string]$Mode,
  [Parameter(Mandatory=$true)][int]$AfterFxPid,
  [Parameter(Mandatory=$true)][string]$StatePath
)
$ErrorActionPreference='Stop'
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class EfM5FloatingBridgeWindow {
 public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int hgt,bool repaint);
 public static IntPtr[] Find(uint target){ var a=new List<IntPtr>(); EnumWindows(delegate(IntPtr h,IntPtr p){uint pid;GetWindowThreadProcessId(h,out pid); if(pid!=target||!IsWindowVisible(h)) return true; var s=new StringBuilder(256);GetClassName(h,s,s.Capacity); if(s.ToString()=="DroverLord - Window Class") a.Add(h); return true;},IntPtr.Zero); return a.ToArray(); }
}
"@
$utf8 = New-Object System.Text.UTF8Encoding($false)
if($Mode -eq 'HIDE'){
  $items=@()
  foreach($h in [EfM5FloatingBridgeWindow]::Find([uint32]$AfterFxPid)){
    $r=New-Object EfM5FloatingBridgeWindow+RECT
    if(-not [EfM5FloatingBridgeWindow]::GetWindowRect($h,[ref]$r)){continue}
    $w=$r.Right-$r.Left; $ht=$r.Bottom-$r.Top
    if($w -lt 800 -or $ht -lt 300){continue}
    $items += [ordered]@{handle=[int64]$h;x=$r.Left;y=$r.Top;width=$w;height=$ht}
    [void][EfM5FloatingBridgeWindow]::MoveWindow($h,2200,1200,$w,$ht,$true)
  }
  if($items.Count -eq 0){throw 'No large visible floating DroverLord window was found for the AE process.'}
  [System.IO.File]::WriteAllText($StatePath,(([ordered]@{version='M5_FLOATING_BRIDGE_WINDOW_V1';pid=$AfterFxPid;items=$items}|ConvertTo-Json -Depth 6)+[Environment]::NewLine),$utf8)
  [pscustomobject]@{ok=$true;mode=$Mode;moved=$items.Count;statePath=$StatePath}|ConvertTo-Json -Compress
  exit 0
}
if(-not(Test-Path $StatePath -PathType Leaf)){throw "Bridge window state missing: $StatePath"}
$s=Get-Content $StatePath -Raw|ConvertFrom-Json
foreach($item in @($s.items)){[void][EfM5FloatingBridgeWindow]::MoveWindow([IntPtr][int64]$item.handle,[int]$item.x,[int]$item.y,[int]$item.width,[int]$item.height,$true)}
Remove-Item $StatePath -Force -ErrorAction SilentlyContinue
[pscustomobject]@{ok=$true;mode=$Mode;restored=@($s.items).Count}|ConvertTo-Json -Compress
