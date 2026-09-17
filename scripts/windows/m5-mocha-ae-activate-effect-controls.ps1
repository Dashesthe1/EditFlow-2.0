param([Parameter(Mandatory=$true)][int]$AfterFxPid,[Parameter(Mandatory=$true)][string]$ResultPath)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EditFlowMochaEffectControlsKey {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 public static bool ForceForeground(IntPtr target){uint fgPid=0,targetPid=0;var fg=GetForegroundWindow();uint fgTid=GetWindowThreadProcessId(fg,out fgPid);uint targetTid=GetWindowThreadProcessId(target,out targetPid);uint self=GetCurrentThreadId();bool a=false,b=false;try{if(fgTid!=0&&fgTid!=self)a=AttachThreadInput(self,fgTid,true);if(targetTid!=0&&targetTid!=self)b=AttachThreadInput(self,targetTid,true);ShowWindow(target,9);BringWindowToTop(target);SetActiveWindow(target);SetForegroundWindow(target);return GetForegroundWindow()==target;}finally{if(b)AttachThreadInput(self,targetTid,false);if(a)AttachThreadInput(self,fgTid,false);}}
}
"@
function Get-ForegroundPid {[uint32]$id=0;$h=[EditFlowMochaEffectControlsKey]::GetForegroundWindow();[void][EditFlowMochaEffectControlsKey]::GetWindowThreadProcessId($h,[ref]$id);[int]$id}
$p=Get-Process -Id $AfterFxPid -ErrorAction Stop
if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'After Effects is not a responsive Effect Controls target.'}
$focus=[EditFlowMochaEffectControlsKey]::ForceForeground($p.MainWindowHandle);Start-Sleep -Milliseconds 80
if(-not $focus -or (Get-ForegroundPid)-ne $AfterFxPid){throw 'Exact After Effects foreground acquisition failed.'}
$wshell=New-Object -ComObject WScript.Shell;$wshell.SendKeys('{F3}');Start-Sleep -Milliseconds 220
$reacquired=$false;if((Get-ForegroundPid)-ne $AfterFxPid){$reacquired=[EditFlowMochaEffectControlsKey]::ForceForeground($p.MainWindowHandle);Start-Sleep -Milliseconds 80}
if((Get-ForegroundPid)-ne $AfterFxPid){throw 'After Effects foreground ownership could not be restored after F3.'}
$payload=[ordered]@{ok=$true;afterFxPid=$AfterFxPid;foregroundPid=(Get-ForegroundPid);key='F3';delivery='AttachThreadInput+SetForegroundWindow+SendKeys';settleMs=220;focusReacquired=$reacquired}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null};[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))