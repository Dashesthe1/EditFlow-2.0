param(
  [Parameter(Mandatory=$true)][int]$MochaPid,
  [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Find-OneByAutomationId($root,[string]$id){
  $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
  $a=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$c); if($a.Count -ne 1){throw "Expected one UIA automation id $id; found $($a.Count)."}; $a.Item(0)
}
function Find-OneButtonByName($root,[string]$name){
  $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name)
  $a=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$c); $b=@(); for($i=0;$i -lt $a.Count;$i+=1){$e=$a.Item($i);if([string]$e.Current.ControlType.ProgrammaticName -eq 'ControlType.Button'){$b+=$e}}
  if($b.Count -ne 1){throw "Expected one exact button $name; found $($b.Count)."}; $b[0]
}
function Invoke-Exact($e,[string]$label){$p=$null;if(-not $e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){throw "$label lacks InvokePattern."}; ([System.Windows.Automation.InvokePattern]$p).Invoke()}
function Read-Frame($slider,$time){
  $rp=$null;if(-not $slider.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern,[ref]$rp)){throw 'Frame slider lacks RangeValuePattern.'}
  $vp=$null;if(-not $time.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){throw 'Current-frame control lacks ValuePattern.'}
  [ordered]@{frame=[int][Math]::Round(([System.Windows.Automation.RangeValuePattern]$rp).Current.Value);timecode=[string]([System.Windows.Automation.ValuePattern]$vp).Current.Value}
}
function Wait-Frame($slider,$time,[int]$expected,[int]$ms){$d=(Get-Date).AddMilliseconds($ms);do{$v=Read-Frame $slider $time;if($v.frame -eq $expected){return $v};Start-Sleep -Milliseconds 25}while((Get-Date)-lt$d);throw "Mocha frame did not reach $expected; last=$($v.frame) $($v.timecode)."}
$p=Get-Process -Id $MochaPid -ErrorAction Stop
if(-not $p.Responding -or $p.MainWindowHandle -eq 0 -or $p.MainWindowTitle -notlike 'Mocha AE*'){throw 'Responsive proof-owned Mocha main window required.'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$slider=Find-OneByAutomationId $root 'frmMain.centralArea.sldrFrameNumber'
$time=Find-OneByAutomationId $root 'frmMain.centralArea.timelineControlsW.timeControlsW.tcedtCurrentFrame'
$prevFrame=Find-OneByAutomationId $root 'frmMain.centralArea.timelineControlsW.transportControlsW.btnPreviousFrame'
$nextFrame=Find-OneByAutomationId $root 'frmMain.centralArea.timelineControlsW.transportControlsW.btnNextFrame'
$prevTracked=Find-OneByAutomationId $root 'frmMain.centralArea.timelineControlsW.prevTrackedRegionB'
$nextTracked=Find-OneByAutomationId $root 'frmMain.centralArea.timelineControlsW.nextTrackedRegionB'
$trackPrev=Find-OneButtonByName $root 'Track To Previous Frame'
$trackNext=Find-OneButtonByName $root 'Track To Next Frame'
$layerCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Layer 1')
$layers=$root.FindAll([System.Windows.Automation.TreeScope]::Subtree,$layerCond)
if($layers.Count -ne 1){throw "Expected exactly one Layer 1 before tracking; found $($layers.Count)."}
$seed=Read-Frame $slider $time;if($seed.frame -ne 1){throw "Bidirectional proof must start at seed frame 1; got $($seed.frame)."}
if(-not $trackNext.Current.IsEnabled -or -not $trackPrev.Current.IsEnabled){throw 'Single-frame forward/backward tracking controls must both be enabled at seed frame 1.'}
$forwardSw=[Diagnostics.Stopwatch]::StartNew();Invoke-Exact $trackNext 'Track To Next Frame';$forwardAfter=Wait-Frame $slider $time 2 12000;$forwardSw.Stop()
Invoke-Exact $prevFrame 'Previous Frame';$forwardReturn=Wait-Frame $slider $time 1 3000
$forwardReadbackSw=[Diagnostics.Stopwatch]::StartNew();Invoke-Exact $nextTracked 'Next Tracked End';$forwardEndpoint=Wait-Frame $slider $time 2 3000;$forwardReadbackSw.Stop()
Invoke-Exact $prevFrame 'Previous Frame';$backwardSeed=Wait-Frame $slider $time 1 3000
$backwardSw=[Diagnostics.Stopwatch]::StartNew();Invoke-Exact $trackPrev 'Track To Previous Frame';$backwardAfter=Wait-Frame $slider $time 0 12000;$backwardSw.Stop()
Invoke-Exact $nextFrame 'Next Frame';$backwardReturn=Wait-Frame $slider $time 1 3000
$backwardReadbackSw=[Diagnostics.Stopwatch]::StartNew();Invoke-Exact $prevTracked 'Previous Tracked End';$backwardEndpoint=Wait-Frame $slider $time 0 3000;$backwardReadbackSw.Stop()
$forwardVerified=($forwardEndpoint.frame -eq 2);$backwardVerified=($backwardEndpoint.frame -eq 0)
$payload=[ordered]@{
  ok=($forwardVerified -and $backwardVerified);direction='BIDIRECTIONAL';seedFrame=1;trackedRange=[ordered]@{startFrame=0;endFrame=2;stepCountEachDirection=1}
  forward=[ordered]@{before=$seed;afterTrack=$forwardAfter;returned=$forwardReturn;trackedEnd=$forwardEndpoint;trackActionMs=[Math]::Round($forwardSw.Elapsed.TotalMilliseconds,3);trackedEndReadbackMs=[Math]::Round($forwardReadbackSw.Elapsed.TotalMilliseconds,3);endpointVerified=$forwardVerified;control=[ordered]@{name=[string]$trackNext.Current.Name;className=[string]$trackNext.Current.ClassName;controlType=[string]$trackNext.Current.ControlType.ProgrammaticName}}
  backward=[ordered]@{before=$backwardSeed;afterTrack=$backwardAfter;returned=$backwardReturn;trackedEnd=$backwardEndpoint;trackActionMs=[Math]::Round($backwardSw.Elapsed.TotalMilliseconds,3);trackedEndReadbackMs=[Math]::Round($backwardReadbackSw.Elapsed.TotalMilliseconds,3);endpointVerified=$backwardVerified;control=[ordered]@{name=[string]$trackPrev.Current.Name;className=[string]$trackPrev.Current.ClassName;controlType=[string]$trackPrev.Current.ControlType.ProgrammaticName}}
  frameSlider=[ordered]@{automationId=[string]$slider.Current.AutomationId;className=[string]$slider.Current.ClassName};layer1Count=[int]$layers.Count;forwardEndpointVerified=$forwardVerified;backwardEndpointVerified=$backwardVerified;trackedRangeVerified=($forwardVerified -and $backwardVerified)
}
$dir=Split-Path -Parent $ResultPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
[IO.File]::WriteAllText($ResultPath,(($payload|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
$payload|ConvertTo-Json -Depth 12
if(-not $payload.ok){exit 1}