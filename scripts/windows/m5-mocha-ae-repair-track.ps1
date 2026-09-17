param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][long]$MochaMainWindowHandle,
  [Parameter(Mandatory=$true)][int]$CorrectionFrame,
  [Parameter(Mandatory=$true)][string]$ArtifactDir,
  [Parameter(Mandatory=$true)][string]$CaptureScript,
  [Parameter(Mandatory=$true)][string]$ResultPath,
  [int]$DefectNudges=8
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EfMochaRepairRect {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
$payload=[ordered]@{ok=$false;mochaPid=$MochaPid;correctionFrame=$CorrectionFrame;defectNudges=$DefectNudges;failure=$null}
function Write-Result { $dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null};[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false))) }
function Get-MochaRoot {
  $p=Get-Process -Id $MochaPid -ErrorAction Stop
  if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'Responsive proof-owned Mocha process required.'}
  $r=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle)
  if($null -eq $r -or [int]$r.Current.ProcessId -ne $MochaPid){throw 'Mocha main-window identity drifted.'}
  return $r
}
function Get-Exact([string]$AutomationId,[int]$WaitMs=1800){
  $deadline=(Get-Date).AddMilliseconds($WaitMs);$last=0
  do{
    $root=Get-MochaRoot
    $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$AutomationId)
    $hits=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond);$last=$hits.Count
    if($last -eq 1){return $hits.Item(0)}
    if($last -gt 1){throw "Multiple controls matched automationId $AutomationId."}
    Start-Sleep -Milliseconds 40
  }while((Get-Date)-lt$deadline)
  throw "Expected one control for automationId $AutomationId; found $last."
}
function Invoke-Exact($Element,[string]$Name){
  if(-not [bool]$Element.Current.IsEnabled){throw "$Name is not enabled."}
  $q=$null;if(-not $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$q)){throw "$Name lacks InvokePattern."}
  $sw=[Diagnostics.Stopwatch]::StartNew();([System.Windows.Automation.InvokePattern]$q).Invoke();$sw.Stop();return [Math]::Round($sw.Elapsed.TotalMilliseconds,3)
}
function Capture([string]$Name){
  $path=Join-Path $ArtifactDir ($Name+'.png')
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutputPath $path | Out-Null
  if($LASTEXITCODE -ne 0 -or -not (Test-Path $path)){throw "Physical evidence capture failed for $Name."}
  return $path
}
$ids=[ordered]@{
  referenceFrame='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnReferenceFrame'
  nudgeRight='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeRight'
  nudgeLeft='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeLeft'
  adjusted='frmMain.LayerProperties.frmLayerProperties.grSetLayerProps.chkbxLinkToAdjustedTrack'
}
try {
  if($CorrectionFrame -lt 0 -or $CorrectionFrame -gt 2){throw "Correction frame $CorrectionFrame is outside retained bounded track range 0..2."}
  if($DefectNudges -lt 1 -or $DefectNudges -gt 16){throw 'DefectNudges must stay within proof bound 1..16.'}
  $root=Get-MochaRoot
  $tabCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'AdjustTrack')
  $tabs=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$tabCond);$tabSelected=$false
  for($i=0;$i -lt $tabs.Count;$i+=1){$e=$tabs.Item($i);$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$q)){$tabSelected=$tabSelected -or [bool]([System.Windows.Automation.SelectionItemPattern]$q).Current.IsSelected}}
  if(-not $tabSelected){throw 'AdjustTrack tab is not selected at repair handoff.'}
  $reference=Get-Exact $ids.referenceFrame;$right=Get-Exact $ids.nudgeRight;$left=Get-Exact $ids.nudgeLeft
  if(-not [bool]$reference.Current.IsEnabled -or -not [bool]$right.Current.IsEnabled -or -not [bool]$left.Current.IsEnabled){throw 'Reference-frame/nudge repair controls are not all enabled.'}
  $wr=New-Object EfMochaRepairRect+RECT
  if(-not [EfMochaRepairRect]::GetWindowRect([IntPtr]$MochaMainWindowHandle,[ref]$wr)){throw 'GetWindowRect failed for proof-owned Mocha.'}
  $payload.window=[ordered]@{left=$wr.L;top=$wr.T;right=$wr.R;bottom=$wr.B;width=$wr.R-$wr.L;height=$wr.B-$wr.T}
  $payload.adjustTrackSelected=$true
  $payload.referenceFrameInvokeMs=Invoke-Exact $reference 'Set Reference Frame'
  Start-Sleep -Milliseconds 180
  $payload.baselineImage=Capture 'repair-baseline'
  $defectTimes=@()
  for($i=0;$i -lt $DefectNudges;$i+=1){$defectTimes+=Invoke-Exact $right 'Nudge Right';Start-Sleep -Milliseconds 30}
  Start-Sleep -Milliseconds 160
  $payload.defectImage=Capture 'repair-defect'
  $repairTimes=@()
  for($i=0;$i -lt $DefectNudges;$i+=1){$repairTimes+=Invoke-Exact $left 'Nudge Left';Start-Sleep -Milliseconds 30}
  Start-Sleep -Milliseconds 180
  $payload.repairedImage=Capture 'repair-repaired'
  $payload.defectNudgeInvokeMs=$defectTimes;$payload.repairNudgeInvokeMs=$repairTimes
  $allTimes=@([double]$payload.referenceFrameInvokeMs)+@($defectTimes|ForEach-Object{[double]$_})+@($repairTimes|ForEach-Object{[double]$_})
  $payload.maxSemanticActionInvokeMs=[Math]::Round((($allTimes|Measure-Object -Maximum).Maximum),3)
  $adjustedState=$null
  try{
    $adjusted=Get-Exact $ids.adjusted 500;$toggle=$null;$q=$null
    if($adjusted.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$q)){$toggle=[string]([System.Windows.Automation.TogglePattern]$q).Current.ToggleState}
    $adjustedState=[ordered]@{present=$true;enabled=[bool]$adjusted.Current.IsEnabled;toggle=$toggle}
  }catch{$adjustedState=[ordered]@{present=$false;enabled=$false;toggle=$null;failure=$_.Exception.Message}}
  $payload.adjustedStateAfterRepair=$adjustedState
  $payload.manualCorrectionPath='SET_REFERENCE_FRAME -> NUDGE_RIGHT x'+$DefectNudges+' -> NUDGE_LEFT x'+$DefectNudges
  $payload.ok=$true
  Write-Result
} catch {
  $payload.failure=$_.Exception.Message
  try{Write-Result}catch{}
  throw
}
$payload|ConvertTo-Json -Depth 12
