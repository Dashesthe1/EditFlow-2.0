param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class EfMochaCloseWin { public long Handle; public string Title; public string ClassName; public bool Visible; public int X,Y,Width,Height; }
public static class EfMochaCloseNative {
  public delegate bool Callback(IntPtr h,IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  public static EfMochaCloseWin[] Run(uint pid){var a=new List<EfMochaCloseWin>();EnumWindows(delegate(IntPtr h,IntPtr p){uint id;GetWindowThreadProcessId(h,out id);if(id!=pid)return true;var t=new StringBuilder(512);var c=new StringBuilder(256);GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);RECT r;GetWindowRect(h,out r);a.Add(new EfMochaCloseWin{Handle=h.ToInt64(),Title=t.ToString(),ClassName=c.ToString(),Visible=IsWindowVisible(h),X=r.L,Y=r.T,Width=r.R-r.L,Height=r.B-r.T});return true;},IntPtr.Zero);return a.ToArray();}
}
"@
function Get-VisibleWindows { @([EfMochaCloseNative]::Run([uint32]$MochaPid)|Where-Object{$_.Visible}) }
function Read-WindowEvidence($windows){
  $out=@()
  foreach($w in $windows){
    $names=@()
    try{
      $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.Handle)
      $all=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)
      for($i=0;$i -lt [Math]::Min($all.Count,120);$i+=1){$n=[string]$all.Item($i).Current.Name;if($n -and -not $names.Contains($n)){$names+=$n}}
    }catch{}
    $out += [ordered]@{handle=$w.Handle;title=$w.Title;className=$w.ClassName;x=$w.X;y=$w.Y;width=$w.Width;height=$w.Height;uiaNames=$names}
  }
  @($out)
}
$p=Get-Process -Id $MochaPid -ErrorAction Stop
$path=[string]$p.MainModule.FileName; $company=[string]$p.MainModule.FileVersionInfo.CompanyName
if($path -notmatch 'mocha4ae_adobe\.exe$' -or $company -notmatch 'Boris FX'){throw 'Exact Boris FX Mocha AE process identity required for proof close.'}
$before=Get-VisibleWindows
$main=@($before|Where-Object{$_.Title -eq 'Mocha AE *' -or $_.Title -eq 'Mocha AE'})
if($main.Count -ne 1){throw "Expected exactly one proof-owned Mocha main window for close; found $($main.Count)."}
if(-not [EfMochaCloseNative]::PostMessage([IntPtr]$main[0].Handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'WM_CLOSE delivery to exact Mocha main window failed.'}
Start-Sleep -Milliseconds 500
$closed=-not [bool](Get-Process -Id $MochaPid -ErrorAction SilentlyContinue)
$unsavedPromptHandled=$false; $promptEvidenceVerified=$false; $dismissAction='NONE'
if(-not $closed){
  $afterClose=Get-VisibleWindows
  $mainAfter=@($afterClose|Where-Object{$_.Title -eq 'Mocha AE *'})
  if($mainAfter.Count -eq 1){
    $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$mainAfter[0].Handle)
    $questionCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Do you want to save the changes you made in the project?')
    $question=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$questionCond)
    $dontCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,"Don't Save")
    $dontAll=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$dontCond); $dont=@()
    for($i=0;$i -lt $dontAll.Count;$i+=1){if([string]$dontAll.Item($i).Current.ControlType.ProgrammaticName -eq 'ControlType.Button'){$dont+=$dontAll.Item($i)}}
    if($question.Count -eq 1 -and $dont.Count -eq 1){
      $promptEvidenceVerified=$true; $pattern=$null
      if(-not $dont[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){throw "Exact Don't Save button did not expose InvokePattern."}
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke(); $unsavedPromptHandled=$true; $dismissAction='INVOKE_DONT_SAVE_EXACT'
      $deadline=(Get-Date).AddSeconds(4); do{Start-Sleep -Milliseconds 100;$closed=-not [bool](Get-Process -Id $MochaPid -ErrorAction SilentlyContinue)}while(-not $closed -and (Get-Date)-lt$deadline)
    }
  }
}
$closed=-not [bool](Get-Process -Id $MochaPid -ErrorAction SilentlyContinue)
$after=@(); if(-not $closed){$after=Get-VisibleWindows}
$payload=[ordered]@{ok=$true;mochaPid=$MochaPid;delivery='WM_CLOSE_EXACT_MAIN_WINDOW';mainHandle=[int64]$main[0].Handle;mainTitle=[string]$main[0].Title;closed=$closed;unsavedPromptHandled=$unsavedPromptHandled;promptEvidenceVerified=$promptEvidenceVerified;dismissAction=$dismissAction;afterWindows=(Read-WindowEvidence $after)}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 12
