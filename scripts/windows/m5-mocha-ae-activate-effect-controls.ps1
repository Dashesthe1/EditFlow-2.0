param(
  [Parameter(Mandatory=$true)][int]$AfterFxPid,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EditFlowMochaEffectControlsKey {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$p=Get-Process -Id $AfterFxPid -ErrorAction Stop
if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'After Effects is not a responsive Effect Controls target.'}
$wshell=New-Object -ComObject WScript.Shell
if(-not $wshell.AppActivate($AfterFxPid)){throw 'Could not activate the exact After Effects process for F3.'}
Start-Sleep -Milliseconds 150
$wshell.SendKeys('{F3}')
Start-Sleep -Milliseconds 300
$fg=[EditFlowMochaEffectControlsKey]::GetForegroundWindow(); [uint32]$fgPid=0
[void][EditFlowMochaEffectControlsKey]::GetWindowThreadProcessId($fg,[ref]$fgPid)
if([int]$fgPid -ne $AfterFxPid){throw 'After Effects did not retain foreground focus after F3.'}
$payload=[ordered]@{ok=$true;afterFxPid=$AfterFxPid;foregroundPid=[int]$fgPid;key='F3';delivery='WScript.SendKeys';settleMs=300}
$dir=Split-Path -Parent $ResultPath; if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
