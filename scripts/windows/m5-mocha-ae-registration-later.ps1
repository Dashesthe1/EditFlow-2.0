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
public sealed class EfMochaTopWindow { public long Handle; public string Title; public bool Visible; }
public static class EfMochaTopWindowEnum {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static EfMochaTopWindow[] Run(uint pid){
    var a=new List<EfMochaTopWindow>();
    EnumWindows(delegate(IntPtr h,IntPtr p){uint id;GetWindowThreadProcessId(h,out id);if(id!=pid)return true;
      var t=new StringBuilder(512);GetWindowText(h,t,t.Capacity);
      a.Add(new EfMochaTopWindow{Handle=h.ToInt64(),Title=t.ToString(),Visible=IsWindowVisible(h)});return true;},IntPtr.Zero);
    return a.ToArray();
  }
}
"@
function Get-MochaWindows {
  @([EfMochaTopWindowEnum]::Run([uint32]$MochaPid) | Where-Object { $_.Visible })
}
function Find-RegisterLaterButton($windows) {
  $hits=@()
  foreach($w in $windows){
    try{
      $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.Handle)
      $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Register later')
      $found=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond)
      for($i=0;$i -lt $found.Count;$i+=1){$hits+=[pscustomobject]@{window=$w;element=$found.Item($i)}}
    }catch{}
  }
  @($hits)
}
$p=Get-Process -Id $MochaPid -ErrorAction Stop
if(-not $p.Responding){throw 'Mocha AE is not responsive before registration handling.'}
$deadline=(Get-Date).AddSeconds(5)
do{
  $windows=Get-MochaWindows
  $registration=@($windows | Where-Object { $_.Title -eq 'Registration' })
  $main=@($windows | Where-Object { $_.Title -eq 'Mocha AE' })
  if($main.Count -gt 1){throw "Expected at most one visible Mocha AE main window; found $($main.Count)."}
  if($main.Count -eq 1){break}
  Start-Sleep -Milliseconds 100
}while((Get-Date)-lt$deadline)
if($main.Count -ne 1){throw "Expected exactly one visible Mocha AE main window before registration handling; found $($main.Count)."}
$dismissed=$false; $invokeMs=$null
if($registration.Count -gt 1){throw "Expected at most one Registration modal; found $($registration.Count)."}
if($registration.Count -eq 1){
  $hits=@(Find-RegisterLaterButton $registration)
  if($hits.Count -ne 1){throw "Expected exactly one Register later element in Registration modal; found $($hits.Count)."}
  $element=$hits[0].element
  if(-not $element.Current.IsEnabled){throw 'Register later button is disabled.'}
  $pattern=$null
  if(-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){throw 'Register later button does not expose InvokePattern.'}
  $sw=[Diagnostics.Stopwatch]::StartNew(); $pattern.Invoke(); $sw.Stop(); $invokeMs=[Math]::Round($sw.Elapsed.TotalMilliseconds,3)
  $deadline=(Get-Date).AddSeconds(5)
  do{Start-Sleep -Milliseconds 100; $windows=Get-MochaWindows; $registration=@($windows|Where-Object{$_.Title -eq 'Registration'})}while($registration.Count -gt 0 -and (Get-Date)-lt$deadline)
  if($registration.Count -ne 0){throw 'Registration modal remained after fixed Register later invocation.'}
  $dismissed=$true
}
$p.Refresh(); if(-not $p.Responding){throw 'Mocha AE became unresponsive after registration handling.'}
$windows=Get-MochaWindows; $main=@($windows|Where-Object{$_.Title -eq 'Mocha AE'})
if($main.Count -ne 1){throw 'Mocha AE main window identity changed after registration handling.'}
$payload=[ordered]@{ok=$true;mochaPid=$MochaPid;registrationPresentInitially=($dismissed);dismissed=$dismissed;action=if($dismissed){'REGISTER_LATER'}else{'NOT_PRESENT'};invokeMs=$invokeMs;mainWindowHandle=[int64]$main[0].Handle;mainWindowTitle=$main[0].Title}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 6)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 6
