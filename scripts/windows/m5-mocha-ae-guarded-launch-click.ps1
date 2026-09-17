param(
  [Parameter(Mandatory=$true)][int]$AfterFxPid,
  [Parameter(Mandatory=$true)][string]$TargetJson,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EditFlowMochaLaunchMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public static uint Mouse(uint flags){var input=new INPUT{type=0,U=new INPUTUNION{mi=new MOUSEINPUT{dwFlags=flags}}};return SendInput(1,new INPUT[]{input},Marshal.SizeOf(typeof(INPUT)));}
}
"@
$oldDpi=[EditFlowMochaLaunchMouse]::SetThreadDpiAwarenessContext([IntPtr](-4))
$target=[IO.File]::ReadAllText($TargetJson,[Text.Encoding]::UTF8)|ConvertFrom-Json
if($target.verified -ne $true){throw 'Mocha visual target is not verified.'}
$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
if([int]$target.width -ne $bounds.Width -or [int]$target.height -ne $bounds.Height){throw 'Fresh target geometry does not match current virtual screen.'}
$iconX=[int]$target.target.x; $y=[int]$target.target.y; $x=$iconX
if($x -gt [int](0.27*$target.width)){throw 'Derived Mocha button-body hit point escaped the bounded launch region.'}
if($x -lt 0 -or $y -lt 0 -or $x -ge $bounds.Width -or $y -ge $bounds.Height){throw 'Mocha target escaped screen bounds.'}
$p=Get-Process -Id $AfterFxPid -ErrorAction Stop
if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'After Effects is not a responsive visible click target.'}
$fg=[EditFlowMochaLaunchMouse]::GetForegroundWindow(); [uint32]$fgPid=0; [void][EditFlowMochaLaunchMouse]::GetWindowThreadProcessId($fg,[ref]$fgPid)
$foregroundActivationApplied=$false
if([int]$fgPid -ne $AfterFxPid){
  [void][EditFlowMochaLaunchMouse]::SetForegroundWindow($p.MainWindowHandle); $foregroundActivationApplied=$true; Start-Sleep -Milliseconds 150
  $fg=[EditFlowMochaLaunchMouse]::GetForegroundWindow(); [uint32]$fgPid=0; [void][EditFlowMochaLaunchMouse]::GetWindowThreadProcessId($fg,[ref]$fgPid)
}
if([int]$fgPid -ne $AfterFxPid){throw 'After Effects is not the foreground process for the guarded Mocha click.'}
$screenX=$bounds.Left+$x; $screenY=$bounds.Top+$y
if(-not [EditFlowMochaLaunchMouse]::SetCursorPos($screenX,$screenY)){throw 'Could not position pointer on verified Mocha target.'}
Start-Sleep -Milliseconds 120
$point=New-Object EditFlowMochaLaunchMouse+POINT; $point.X=$screenX; $point.Y=$screenY
$hit=[EditFlowMochaLaunchMouse]::WindowFromPoint($point); if($hit -eq [IntPtr]::Zero){throw 'WindowFromPoint did not resolve the Mocha button receiver.'}
[uint32]$hitPid=0; [void][EditFlowMochaLaunchMouse]::GetWindowThreadProcessId($hit,[ref]$hitPid)
if([int]$hitPid -ne $AfterFxPid){throw "Verified Mocha point resolved outside After Effects PID $AfterFxPid."}
$classText=New-Object Text.StringBuilder 256; [void][EditFlowMochaLaunchMouse]::GetClassName($hit,$classText,$classText.Capacity)
$titleText=New-Object Text.StringBuilder 512; [void][EditFlowMochaLaunchMouse]::GetWindowText($hit,$titleText,$titleText.Capacity)
$down=[EditFlowMochaLaunchMouse]::Mouse(0x0002); if($down -ne 1){throw 'SendInput did not deliver Mocha mouse-down.'}
Start-Sleep -Milliseconds 120
$up=[EditFlowMochaLaunchMouse]::Mouse(0x0004); if($up -ne 1){throw 'SendInput did not deliver Mocha mouse-up.'}
$payload=[ordered]@{ok=$true;afterFxPid=$AfterFxPid;foregroundPid=[int]$fgPid;foregroundActivationApplied=$foregroundActivationApplied;iconImageX=$iconX;imageX=$x;imageY=$y;screenX=$screenX;screenY=$screenY;hitOffsetX=0;delivery='SendInput.HumanTimed.PhysicalDpi';receiverHandle=[int64]$hit;receiverPid=[int]$hitPid;receiverClass=$classText.ToString();receiverTitle=$titleText.ToString();downEvents=[int]$down;upEvents=[int]$up;clickedAt=(Get-Date).ToUniversalTime().ToString('o')}
$dir=Split-Path -Parent $ResultPath; if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 6)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 6
[void][EditFlowMochaLaunchMouse]::SetThreadDpiAwarenessContext($oldDpi)
