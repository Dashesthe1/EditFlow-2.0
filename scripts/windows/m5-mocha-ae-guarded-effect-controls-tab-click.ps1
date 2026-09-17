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
public static class EditFlowMochaEffectControlsTabMouse {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
$target=[IO.File]::ReadAllText($TargetJson,[Text.Encoding]::UTF8)|ConvertFrom-Json
if($target.verified -ne $true){throw 'Effect Controls tab target is not verified.'}
$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
if([int]$target.width -ne $bounds.Width -or [int]$target.height -ne $bounds.Height){throw 'Effect Controls target geometry does not match the current virtual screen.'}
$x=[int]$target.target.x; $y=[int]$target.target.y
if($x -lt 0 -or $y -lt 0 -or $x -ge $bounds.Width -or $y -ge $bounds.Height){throw 'Effect Controls tab target escaped screen bounds.'}
$p=Get-Process -Id $AfterFxPid -ErrorAction Stop
if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'After Effects is not a responsive Effect Controls tab target.'}
[void][EditFlowMochaEffectControlsTabMouse]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 100
$fg=[EditFlowMochaEffectControlsTabMouse]::GetForegroundWindow(); [uint32]$fgPid=0; [void][EditFlowMochaEffectControlsTabMouse]::GetWindowThreadProcessId($fg,[ref]$fgPid)
if([int]$fgPid -ne $AfterFxPid){throw 'After Effects did not become the foreground window for Effect Controls activation.'}
$screenX=$bounds.Left+$x; $screenY=$bounds.Top+$y
if(-not [EditFlowMochaEffectControlsTabMouse]::SetCursorPos($screenX,$screenY)){throw 'Could not position pointer on verified Effect Controls tab.'}
Start-Sleep -Milliseconds 30
[EditFlowMochaEffectControlsTabMouse]::mouse_event(0x0002,[uint32]$screenX,[uint32]$screenY,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 25
[EditFlowMochaEffectControlsTabMouse]::mouse_event(0x0004,[uint32]$screenX,[uint32]$screenY,0,[UIntPtr]::Zero)
$payload=[ordered]@{ok=$true;afterFxPid=$AfterFxPid;foregroundPid=[int]$fgPid;imageX=$x;imageY=$y;screenX=$screenX;screenY=$screenY;clickedAt=(Get-Date).ToUniversalTime().ToString('o')}
$dir=Split-Path -Parent $ResultPath; if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 6)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 6
