param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][long]$MochaMainWindowHandle,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$p=Get-Process -Id $MochaPid -ErrorAction Stop
if(-not $p.Responding){throw 'Responsive proof-owned Mocha process required.'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle)
if($null -eq $root){throw 'Captured Mocha main-window handle no longer resolves.'}
if([int]$root.Current.ProcessId -ne $MochaPid -or [string]$root.Current.Name -notmatch '^Mocha AE( \*)?$'){throw 'Mocha root identity drifted.'}
$beforeCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Workspace: Essentials')
$beforeMatches=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$beforeCond)
$workspace=@();for($i=0;$i -lt $beforeMatches.Count;$i+=1){$e=$beforeMatches.Item($i);if([string]$e.Current.ControlType.ProgrammaticName -eq 'ControlType.MenuItem' -and [string]$e.Current.ClassName -eq 'QAction'){$workspace+=$e}}
if($workspace.Count -ne 1){throw "Expected one Workspace: Essentials QAction; found $($workspace.Count)."}
$menuMode=$null;$exp=$null;$inv=$null
if($workspace[0].TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$exp)){([System.Windows.Automation.ExpandCollapsePattern]$exp).Expand();$menuMode='EXPAND_COLLAPSE'}
elseif($workspace[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$inv)){([System.Windows.Automation.InvokePattern]$inv).Invoke();$menuMode='INVOKE'}
else{throw 'Workspace menu is not semantically actionable.'}
Start-Sleep -Milliseconds 200
$desktop=[System.Windows.Automation.AutomationElement]::RootElement
$tops=$desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$classic=@()
for($i=0;$i -lt $tops.Count;$i+=1){
  $top=$tops.Item($i);if([int]$top.Current.ProcessId -ne $MochaPid){continue}
  $all=$top.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  if($all.Count -gt 1800){throw "Mocha UI tree exceeded bounded workspace discovery budget: $($all.Count)"}
  for($j=0;$j -lt $all.Count;$j+=1){
    $e=$all.Item($j);$c=$e.Current
    if([string]$c.Name -eq 'Classic' -and [string]$c.ControlType.ProgrammaticName -eq 'ControlType.MenuItem' -and [string]$c.ClassName -eq 'QAction'){$classic+=$e}
  }
}
if($classic.Count -ne 1){throw "Expected one Classic workspace QAction; found $($classic.Count)."}
$q=$null;if(-not $classic[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$q)){throw 'Classic workspace QAction has no InvokePattern.'}
([System.Windows.Automation.InvokePattern]$q).Invoke()
Start-Sleep -Milliseconds 450
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle)
if($null -eq $root){throw 'Mocha root disappeared after Classic workspace switch.'}
$afterCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Workspace: Classic')
$afterMatches=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$afterCond)
$after=@();for($i=0;$i -lt $afterMatches.Count;$i+=1){$e=$afterMatches.Item($i);if([string]$e.Current.ControlType.ProgrammaticName -eq 'ControlType.MenuItem' -and [string]$e.Current.ClassName -eq 'QAction'){$after+=$e}}
if($after.Count -ne 1){throw "Classic workspace switch was not independently verified; found $($after.Count) Workspace: Classic actions."}
$tabCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'AdjustTrack')
$tabMatches=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$tabCond)
$tabs=@();for($i=0;$i -lt $tabMatches.Count;$i+=1){$e=$tabMatches.Item($i);if([string]$e.Current.ControlType.ProgrammaticName -eq 'ControlType.TabItem'){$tabs+=$e}}
if($tabs.Count -ne 1){throw "Expected one AdjustTrack tab item; found $($tabs.Count)."}
$tabMode=$null;$sel=$null;$tabInvoke=$null
if($tabs[0].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$sel)){([System.Windows.Automation.SelectionItemPattern]$sel).Select();$tabMode='SELECTION_ITEM'}
elseif($tabs[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$tabInvoke)){([System.Windows.Automation.InvokePattern]$tabInvoke).Invoke();$tabMode='INVOKE'}
else{throw 'AdjustTrack tab is not semantically actionable.'}
Start-Sleep -Milliseconds 350
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle)
$tabMatches=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$tabCond)
$selectedAdjust=$false;for($i=0;$i -lt $tabMatches.Count;$i+=1){$e=$tabMatches.Item($i);$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$q)){$selectedAdjust=$selectedAdjust -or [bool]([System.Windows.Automation.SelectionItemPattern]$q).Current.IsSelected}}
if(-not $selectedAdjust){throw 'AdjustTrack tab selection was not independently verified.'}
$tree=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition)
if($tree.Count -gt 2500){throw "Mocha Classic UI tree exceeded bounded discovery budget: $($tree.Count)"}
$items=@()
for($i=0;$i -lt $tree.Count;$i+=1){
  $e=$tree.Item($i);$c=$e.Current;$name=[string]$c.Name;$aid=[string]$c.AutomationId;$cls=[string]$c.ClassName;$ct=[string]$c.ControlType.ProgrammaticName
  if(($name+' '+$aid+' '+$cls) -notmatch '(?i)adjust|track|surface|module|tab|classic|minimal|stacked|reference|transform|link to track'){continue}
  $r=$c.BoundingRectangle;$invoke=$false;$toggle=$null;$selected=$null
  try{$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$q)){$invoke=$true}}catch{}
  try{$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$q)){$toggle=[string]([System.Windows.Automation.TogglePattern]$q).Current.ToggleState}}catch{}
  try{$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$q)){$selected=[bool]([System.Windows.Automation.SelectionItemPattern]$q).Current.IsSelected}}catch{}
  $items += [ordered]@{index=$i;name=$name;automationId=$aid;className=$cls;controlType=$ct;enabled=[bool]$c.IsEnabled;offscreen=[bool]$c.IsOffscreen;x=[math]::Round($r.X);y=[math]::Round($r.Y);w=[math]::Round($r.Width);h=[math]::Round($r.Height);invoke=$invoke;toggle=$toggle;selected=$selected}
}
$adjust=@($items|Where-Object{($_.name+' '+$_.automationId+' '+$_.className) -match '(?i)adjust'})
$setPointIds=[ordered]@{
  setPoints='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxTransform.btnSetPoints'
  keyframeAll='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.keyframeAllPoints'
  addPoint='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnAddPoint'
  selectPrev='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnSelectPrevPoint'
  selectNext='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnSelectNextPoint'
  lockPoints='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnLockPoints'
  deletePoints='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnDeletePoints'
  resetAll='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnResetAll'
  referenceFrame='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxRefPoints.btnReferenceFrame'
  nudgeLeft='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeLeft'
  nudgeRight='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeRight'
  nudgeUp='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeUp'
  nudgeDown='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.nudgeGroup.btnNudgeDown'
  autoStep='qt_tabwidget_stackedwidget.frmAdjustTrackPage.versionTabs.qt_tabwidget_stackedwidget.tabTransform.adjustTrackTransform.grpbxAutoOptimise.chkboxAutoStep'
}
function Find-InTree($Tree,[string]$AutomationId,[bool]$Required=$false){
  $matches=@();for($ti=0;$ti -lt $Tree.Count;$ti+=1){$te=$Tree.Item($ti);if([string]$te.Current.AutomationId -eq $AutomationId){$matches+=$te}}
  if($matches.Count -gt 1){throw "Multiple controls matched automationId $AutomationId in one verified AdjustTrack tree."}
  if($Required -and $matches.Count -ne 1){throw "Expected one control for automationId $AutomationId in verified AdjustTrack tree; found $($matches.Count)."}
  if($matches.Count -eq 1){return $matches[0]};return $null
}
function State-FromTree($Tree,[string]$AutomationId){
  $e=Find-InTree $Tree $AutomationId $false;if($null -eq $e){return [ordered]@{present=$false;automationId=$AutomationId}}
  $c=$e.Current;$toggle=$null;$invoke=$false
  try{$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$q)){$toggle=[string]([System.Windows.Automation.TogglePattern]$q).Current.ToggleState}}catch{}
  try{$q=$null;if($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$q)){$invoke=$true}}catch{}
  return [ordered]@{present=$true;name=[string]$c.Name;automationId=$AutomationId;controlType=[string]$c.ControlType.ProgrammaticName;className=[string]$c.ClassName;enabled=[bool]$c.IsEnabled;offscreen=[bool]$c.IsOffscreen;toggle=$toggle;invoke=$invoke}
}
function Snapshot-FromTree($Tree){$s=[ordered]@{};foreach($entry in $setPointIds.GetEnumerator()){$s[$entry.Key]=State-FromTree $Tree $entry.Value};return $s}
$setPointsBefore=Snapshot-FromTree $tree
$prePayload=[ordered]@{ok=$false;phase='PRE_SET_POINTS';mochaPid=$MochaPid;workspaceClassicVerified=$true;adjustTrackMode=$tabMode;adjustTrackSelected=$selectedAdjust;treeCount=$tree.Count;setPointsBefore=$setPointsBefore;items=$items}
$preDir=Split-Path -Parent $ResultPath;if($preDir){New-Item -ItemType Directory -Force -Path $preDir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($prePayload|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$setButton=Find-InTree $tree $setPointIds.setPoints $true
if(-not [bool]$setButton.Current.IsEnabled){throw 'AdjustTrack Set Points was not enabled in the verified AdjustTrack tree.'}
$setInvoke=$null;if(-not $setButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$setInvoke)){throw 'AdjustTrack Set Points lacks InvokePattern.'}
$setSw=[Diagnostics.Stopwatch]::StartNew();([System.Windows.Automation.InvokePattern]$setInvoke).Invoke();Start-Sleep -Milliseconds 280;$setSw.Stop()
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle);if($null -eq $root){throw 'Mocha root disappeared after Set Points.'}
$treeAfterSet=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition);if($treeAfterSet.Count -gt 2500){throw "Mocha UI tree exceeded bounded post-Set-Points budget: $($treeAfterSet.Count)"}
$setPointsAfter=Snapshot-FromTree $treeAfterSet
$selectAction='SKIPPED';$selectInvokeMs=$null;$setPointsAfterSelect=$null
$selectNext=Find-InTree $treeAfterSet $setPointIds.selectNext $false
if($null -ne $selectNext -and [bool]$selectNext.Current.IsEnabled){$selectInvoke=$null;if($selectNext.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$selectInvoke)){$selectSw=[Diagnostics.Stopwatch]::StartNew();([System.Windows.Automation.InvokePattern]$selectInvoke).Invoke();Start-Sleep -Milliseconds 220;$selectSw.Stop();$selectAction='SELECT_NEXT';$selectInvokeMs=[Math]::Round($selectSw.Elapsed.TotalMilliseconds,3);$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$MochaMainWindowHandle);$treeAfterSelect=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,[System.Windows.Automation.Condition]::TrueCondition);$setPointsAfterSelect=Snapshot-FromTree $treeAfterSelect}}
$setPointsVerified=((Get-Process -Id $MochaPid -ErrorAction Stop).Responding -and $setPointsAfter.setPoints.present)
if(-not $setPointsVerified){throw 'AdjustTrack Set Points transaction did not retain a responsive observable AdjustTrack tree.'}
$payload=[ordered]@{ok=$true;phase='POST_SET_POINTS';mochaPid=$MochaPid;workspaceMenuMode=$menuMode;classicCandidateCount=$classic.Count;workspaceClassicVerified=$true;adjustTrackMode=$tabMode;adjustTrackSelected=$selectedAdjust;setPointsVerified=$setPointsVerified;setPointsInvokeMs=[Math]::Round($setSw.Elapsed.TotalMilliseconds,3);selectAction=$selectAction;selectInvokeMs=$selectInvokeMs;setPointsBefore=$setPointsBefore;setPointsAfter=$setPointsAfter;setPointsAfterSelect=$setPointsAfterSelect;treeCount=$tree.Count;postSetTreeCount=$treeAfterSet.Count;hitCount=$items.Count;adjustHitCount=$adjust.Count;adjustHits=$adjust;items=$items}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 12
