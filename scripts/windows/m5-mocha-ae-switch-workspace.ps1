param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][long]$MochaMainWindowHandle,
  [Parameter(Mandatory=$true)][string]$ResultPath,
  [switch]$WorkspaceOnly
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Get-MochaRoot {
  $p=Get-Process -Id $MochaPid -ErrorAction Stop
  if(-not $p.Responding -or $p.MainWindowHandle -eq 0){throw 'Responsive proof-owned Mocha process required.'}
  $r=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  if($null -eq $r -or [int]$r.Current.ProcessId -ne $MochaPid){throw 'Mocha root identity drifted.'}
  return $r
}
function Find-ProcessActions([string]$ExactName,[string]$ExactAutomationId='') {
  $desktop=[System.Windows.Automation.AutomationElement]::RootElement
  $tops=$desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  $hits=@();$nodeBudget=0
  for($i=0;$i -lt $tops.Count;$i+=1){
    $top=$tops.Item($i);if([int]$top.Current.ProcessId -ne $MochaPid){continue}
    $c=$top.Current
    if([string]$c.Name -eq $ExactName -and [string]$c.ControlType.ProgrammaticName -eq 'ControlType.MenuItem' -and [string]$c.ClassName -eq 'QAction' -and (-not $ExactAutomationId -or [string]$c.AutomationId -eq $ExactAutomationId)){$hits+=$top}
    $nodes=$top.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);$nodeBudget+=$nodes.Count
    if($nodeBudget -gt 3500){throw "Mocha process UI tree exceeded bounded workspace-search budget: $nodeBudget"}
    for($j=0;$j -lt $nodes.Count;$j+=1){$e=$nodes.Item($j);$c=$e.Current;if([string]$c.Name -eq $ExactName -and [string]$c.ControlType.ProgrammaticName -eq 'ControlType.MenuItem' -and [string]$c.ClassName -eq 'QAction' -and (-not $ExactAutomationId -or [string]$c.AutomationId -eq $ExactAutomationId)){$hits+=$e}}
  }
  return ,$hits
}
function Find-CurrentWorkspace {
  $names=@('Workspace: Essentials','Workspace: Classic','Workspace: Big Picture','Workspace: Roto');$hits=@()
  foreach($n in $names){$found=@(Find-ProcessActions $n);foreach($e in $found){$hits+=$e}}
  if($hits.Count -eq 1){return $hits[0]}
  return $null
}
$root=Get-MochaRoot
$current=$null;$deadline=(Get-Date).AddSeconds(4)
do{$current=Find-CurrentWorkspace;if($null -ne $current){break};Start-Sleep -Milliseconds 60}while((Get-Date)-lt$deadline)
if($null -eq $current){throw 'Current Mocha workspace QAction did not settle in the proof-owned process tree before timeout.'}
$before=[string]$current.Current.Name;$changed=$false;$menuMode='ALREADY_ESSENTIALS';$targetSearchMode='NONE'
if($before -ne 'Workspace: Essentials'){
  $targets=@(Find-ProcessActions 'Essentials' 'Essentials')
  if($targets.Count -ne 1){
    $exp=$null;$inv=$null
    if($current.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$exp)){([System.Windows.Automation.ExpandCollapsePattern]$exp).Expand();$menuMode='EXPAND_COLLAPSE'}
    elseif($current.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$inv)){([System.Windows.Automation.InvokePattern]$inv).Invoke();$menuMode='INVOKE'}
    else{throw 'Workspace menu is not semantically actionable.'}
    $deadline=(Get-Date).AddSeconds(3);do{Start-Sleep -Milliseconds 50;$targets=@(Find-ProcessActions 'Essentials' 'Essentials');if($targets.Count -eq 1){break}}while((Get-Date)-lt$deadline)
    $targetSearchMode='OPENED_MENU'
  }else{$targetSearchMode='ALREADY_EXPOSED'}
  if($targets.Count -ne 1){throw "Expected one exact Essentials workspace QAction; found $($targets.Count)."}
  $q=$null;if(-not $targets[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$q)){throw 'Essentials workspace QAction has no InvokePattern.'}
  ([System.Windows.Automation.InvokePattern]$q).Invoke();$changed=$true
}
$ready=$false;$workspaceVerified=$false;$sliderVerified=$false;$nextVerified=$false;$deadline=(Get-Date).AddSeconds(5)
do{
  Start-Sleep -Milliseconds 60;$root=Get-MochaRoot
  $essentialCurrent=@(Find-ProcessActions 'Workspace: Essentials');$workspaceVerified=($essentialCurrent.Count -eq 1)
  $sliderCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'frmMain.centralArea.sldrFrameNumber')
  $nextCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'frmMain.centralArea.timelineControlsW.transportControlsW.btnNextFrame')
  $sliders=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$sliderCond);$nexts=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$nextCond)
  $sliderVerified=($sliders.Count -eq 1);$nextVerified=($nexts.Count -eq 1);$ready=$workspaceVerified -and ($WorkspaceOnly -or ($sliderVerified -and $nextVerified))
  if($ready){break}
}while((Get-Date)-lt$deadline)
if(-not $ready){throw "Essentials workspace did not settle: workspace=$workspaceVerified slider=$sliderVerified next=$nextVerified"}
$payload=[ordered]@{ok=$true;mochaPid=$MochaPid;before=$before;after='Workspace: Essentials';changed=$changed;menuMode=$menuMode;targetSearchMode=$targetSearchMode;workspaceOnly=[bool]$WorkspaceOnly;workspaceVerified=$workspaceVerified;sliderVerified=$sliderVerified;nextFrameVerified=$nextVerified}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 8)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 8
