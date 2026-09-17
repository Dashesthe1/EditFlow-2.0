param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EfMochaPlanarRegionInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int cb);
  public static uint Mouse(uint f){var i=new INPUT{type=0,U=new INPUTUNION{mi=new MOUSEINPUT{dwFlags=f}}};return SendInput(1,new INPUT[]{i},Marshal.SizeOf(typeof(INPUT)));}
}
"@
$oldDpi=[EfMochaPlanarRegionInput]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $p=Get-Process -Id $MochaPid -ErrorAction Stop
  if(-not $p.Responding -or $p.MainWindowHandle -eq 0 -or $p.MainWindowTitle -ne 'Mocha AE'){throw 'Exact responsive Mocha AE main window required.'}
  $vi=$p.MainModule.FileVersionInfo
  if([string]$vi.CompanyName -notmatch 'Boris FX'){throw 'Mocha process company identity mismatch.'}
  $path=[string]$p.MainModule.FileName
  if($path -notmatch 'mocha4ae_adobe\.exe$'){throw 'Mocha executable identity mismatch.'}
  $r=New-Object EfMochaPlanarRegionInput+RECT
  if(-not [EfMochaPlanarRegionInput]::GetWindowRect($p.MainWindowHandle,[ref]$r)){throw 'Could not read Mocha window bounds.'}
  $w=$r.R-$r.L; $h=$r.B-$r.T
  if($w -lt 1400 -or $h -lt 800){throw "Mocha window too small for bounded planar proof: ${w}x${h}."}
  $norm=@(@(0.57,0.35),@(0.67,0.37),@(0.69,0.49),@(0.58,0.52))
  $points=@()
  foreach($n in $norm){
    $x=[int][Math]::Round($r.L+$n[0]*$w); $y=[int][Math]::Round($r.T+$n[1]*$h)
    if($x -lt ($r.L+[int](0.45*$w)) -or $y -lt ($r.T+[int](0.15*$h)) -or $y -gt ($r.T+[int](0.85*$h))){throw 'Explicit planar point escaped guarded viewer region.'}
    $pt=New-Object EfMochaPlanarRegionInput+POINT; $pt.X=$x; $pt.Y=$y
    $hit=[EfMochaPlanarRegionInput]::WindowFromPoint($pt); [uint32]$hitPid=0; [void][EfMochaPlanarRegionInput]::GetWindowThreadProcessId($hit,[ref]$hitPid)
    if([int]$hitPid -ne $MochaPid){throw "Planar point resolves outside Mocha PID $MochaPid."}
    $points += [ordered]@{x=$x;y=$y;nx=$n[0];ny=$n[1];receiverPid=[int]$hitPid}
  }
  [void][EfMochaPlanarRegionInput]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 120
  $fg=[EfMochaPlanarRegionInput]::GetForegroundWindow(); [uint32]$fgPid=0; [void][EfMochaPlanarRegionInput]::GetWindowThreadProcessId($fg,[ref]$fgPid)
  if([int]$fgPid -ne $MochaPid){throw 'Mocha AE did not retain foreground focus for planar-region input.'}
  $shell=New-Object -ComObject WScript.Shell
  $toolX=[int][Math]::Round($r.L+0.159*$w); $toolY=[int][Math]::Round($r.T+0.073*$h)
  $toolPt=New-Object EfMochaPlanarRegionInput+POINT; $toolPt.X=$toolX; $toolPt.Y=$toolY
  $toolHit=[EfMochaPlanarRegionInput]::WindowFromPoint($toolPt); [uint32]$toolHitPid=0; [void][EfMochaPlanarRegionInput]::GetWindowThreadProcessId($toolHit,[ref]$toolHitPid)
  if([int]$toolHitPid -ne $MochaPid){throw 'Candidate X-Spline tool point resolves outside Mocha.'}
  [void][EfMochaPlanarRegionInput]::SetCursorPos($toolX,$toolY); Start-Sleep -Milliseconds 1300
  $ae=[System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($toolX,$toolY)))
  $toolProbe=[ordered]@{x=$toolX;y=$toolY;name=[string]$ae.Current.Name;automationId=[string]$ae.Current.AutomationId;className=[string]$ae.Current.ClassName;controlType=[string]$ae.Current.ControlType.ProgrammaticName}
  if($toolProbe.name -ne 'Create X-spline Layer' -or $toolProbe.className -ne 'GUI::DropdownToolButton' -or $toolProbe.controlType -ne 'ControlType.Button'){throw 'Exact Create X-spline Layer tool identity was not verified.'}
  $sw=[Diagnostics.Stopwatch]::StartNew()
  if(-not [EfMochaPlanarRegionInput]::SetCursorPos($toolX,$toolY)){throw 'Could not position exact X-Spline tool pointer.'}
  if([EfMochaPlanarRegionInput]::Mouse(0x0002) -ne 1){throw 'X-Spline tool mouse-down was not delivered.'}
  Start-Sleep -Milliseconds 45
  if([EfMochaPlanarRegionInput]::Mouse(0x0004) -ne 1){throw 'X-Spline tool mouse-up was not delivered.'}
  Start-Sleep -Milliseconds 120
  foreach($pt in $points){
    if(-not [EfMochaPlanarRegionInput]::SetCursorPos([int]$pt.x,[int]$pt.y)){throw 'Could not position planar-region pointer.'}
    Start-Sleep -Milliseconds 60
    if([EfMochaPlanarRegionInput]::Mouse(0x0002) -ne 1){throw 'Planar-region mouse-down was not delivered.'}
    Start-Sleep -Milliseconds 45
    if([EfMochaPlanarRegionInput]::Mouse(0x0004) -ne 1){throw 'Planar-region mouse-up was not delivered.'}
    Start-Sleep -Milliseconds 80
  }
  $shell.SendKeys('c'); Start-Sleep -Milliseconds 500; $sw.Stop()
  $p.Refresh(); if(-not $p.Responding){throw 'Mocha AE became unresponsive after planar-region input.'}
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  $layerCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Layer 1')
  $layers=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$layerCond)
  $payload=[ordered]@{ok=$true;mochaPid=$MochaPid;tool='CREATE_X_SPLINE_LAYER';toolActivation='PHYSICAL_EXACT_UIA_TARGET';closeShortcut='C';toolProbe=$toolProbe;window=[ordered]@{left=$r.L;top=$r.T;width=$w;height=$h};points=$points;actionBatchMs=[Math]::Round($sw.Elapsed.TotalMilliseconds,3);layer1UiaCount=[int]$layers.Count;layer1UiaVerified=($layers.Count -eq 1)}
  $dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
  [IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 8)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
  $payload|ConvertTo-Json -Depth 8
} finally {
  [void][EfMochaPlanarRegionInput]::SetThreadDpiAwarenessContext($oldDpi)
}
