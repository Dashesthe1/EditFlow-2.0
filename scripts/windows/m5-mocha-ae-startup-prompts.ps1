param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class EfMochaPromptWindow { public long Handle; public string Title; public bool Visible; }
public static class EfMochaPromptWindows {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
  public static EfMochaPromptWindow[] Run(uint pid){var a=new List<EfMochaPromptWindow>(); EnumWindows(delegate(IntPtr h,IntPtr p){uint id;GetWindowThreadProcessId(h,out id);if(id!=pid)return true;var t=new StringBuilder(512);GetWindowText(h,t,t.Capacity);a.Add(new EfMochaPromptWindow{Handle=h.ToInt64(),Title=t.ToString(),Visible=IsWindowVisible(h)});return true;},IntPtr.Zero);return a.ToArray();}
}
"@
function Get-VisibleMochaWindows { @([EfMochaPromptWindows]::Run([uint32]$MochaPid) | Where-Object { $_.Visible }) }
$p=Get-Process -Id $MochaPid -ErrorAction Stop
if(-not $p.Responding){throw 'Mocha AE is not responsive before startup-prompt handling.'}
$baseTitles=@('Mocha AE','Mocha AE Plugin 2025')
$promptTitles=@('Welcome to Mocha AE','Thank you from Boris FX')
$dismissed=@()
Start-Sleep -Milliseconds 1000
for($pass=0;$pass -lt 6;$pass+=1){
  $windows=Get-VisibleMochaWindows
  $main=@($windows|Where-Object{$_.Title -eq 'Mocha AE'})
  if($main.Count -ne 1){throw "Expected exactly one Mocha AE main window; found $($main.Count)."}
  $prompts=@($windows|Where-Object{$promptTitles -contains $_.Title})
  if($prompts.Count -gt 1){throw ('Multiple fixed startup prompts were visible: '+(($prompts|ForEach-Object Title)-join ', '))}
  if($prompts.Count -eq 1){
    $title=[string]$prompts[0].Title
    if(-not [EfMochaPromptWindows]::PostMessage([IntPtr]$prompts[0].Handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw "Could not close fixed Mocha startup prompt: $title"}
    $deadline=(Get-Date).AddSeconds(3)
    do{Start-Sleep -Milliseconds 100;$windows=Get-VisibleMochaWindows;$same=@($windows|Where-Object{$_.Title -eq $title})}while($same.Count -gt 0 -and (Get-Date)-lt$deadline)
    if($same.Count -ne 0){throw "Fixed Mocha startup prompt remained after close: $title"}
    $dismissed+=$title
    Start-Sleep -Milliseconds 300
    continue
  }
  $unexpected=@($windows|Where-Object{$_.Title -and -not($baseTitles -contains $_.Title)})
  if($unexpected.Count -ne 0){throw ('Unexpected visible Mocha window after startup-prompt handling: '+(($unexpected|ForEach-Object Title)-join ', '))}
  Start-Sleep -Milliseconds 700
  $settled=Get-VisibleMochaWindows
  $late=@($settled|Where-Object{$promptTitles -contains $_.Title})
  if($late.Count -eq 0){break}
}
$p.Refresh(); if(-not $p.Responding){throw 'Mocha AE became unresponsive after startup-prompt handling.'}
$windows=Get-VisibleMochaWindows
$main=@($windows|Where-Object{$_.Title -eq 'Mocha AE'})
if($main.Count -ne 1){throw 'Mocha AE main window identity changed after startup-prompt handling.'}
$unexpected=@($windows|Where-Object{$_.Title -and -not($baseTitles -contains $_.Title)})
if($unexpected.Count -ne 0){throw ('Unexpected visible Mocha window after startup-prompt handling: '+(($unexpected|ForEach-Object Title)-join ', '))}
$payload=[ordered]@{ok=$true;mochaPid=$MochaPid;fixedPromptTitles=$promptTitles;dismissedTitles=$dismissed;dismissedCount=$dismissed.Count;mainWindowHandle=[int64]$main[0].Handle;mainWindowTitle=$main[0].Title}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 8)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 8
