param(
  [Parameter(Mandatory=$true)][int]$AfterFxPid,
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
public class EfAeWindow { public long Handle; public string ClassName; public string Title; public bool Visible; public int X; public int Y; public int Width; public int Height; }
public static class EfAeWindowEnum {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  public static EfAeWindow[] Run(uint pid){var a=new List<EfAeWindow>(); EnumWindows(delegate(IntPtr h,IntPtr p){uint id;GetWindowThreadProcessId(h,out id);if(id!=pid)return true;var t=new StringBuilder(512);var c=new StringBuilder(256);GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);Rect r;GetWindowRect(h,out r);a.Add(new EfAeWindow{Handle=h.ToInt64(),ClassName=c.ToString(),Title=t.ToString(),Visible=IsWindowVisible(h),X=r.L,Y=r.T,Width=r.R-r.L,Height=r.B-r.T});return true;},IntPtr.Zero);return a.ToArray();}
}
"@
$windows=@([EfAeWindowEnum]::Run([uint32]$AfterFxPid) | Where-Object { $_.Visible })
$evidence=@()
foreach($w in $windows){
  $names=@()
  try{
    $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.Handle)
    $all=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)
    for($i=0;$i -lt $all.Count;$i+=1){$n=[string]$all.Item($i).Current.Name;if($n -and -not $names.Contains($n)){$names+=$n}}
  }catch{}
  $evidence += [ordered]@{handle=$w.Handle;className=$w.ClassName;title=$w.Title;x=$w.X;y=$w.Y;width=$w.Width;height=$w.Height;uiaNames=$names}
}
$payload=[ordered]@{afterFxPid=$AfterFxPid;capturedAt=(Get-Date).ToUniversalTime().ToString('o');windows=$evidence}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 10)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 10
