param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.com",
  [int]$TimeoutSeconds = 45
)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
if(-not $ArtifactDir){throw 'EDITFLOW_PROOF_ARTIFACT_DIR is required.'}
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
$SourceProbe=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-source-probe.jsx'
$EnterScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-isolation-enter.jsx'
$FixtureScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-fixture-apply.jsx'
$ControlsScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-effect-controls-prepare.jsx'
$ActivateControlsScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-activate-effect-controls.ps1'
$RestoreScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-isolation-restore.jsx'
$CaptureScript=Join-Path $RepoRoot 'scripts\windows\m5-capture-ae-screen-physical.ps1'
$TargetScript=Join-Path $RepoRoot 'scripts\m5-mocha-ae-launch-target.py'
$TabTargetScript=Join-Path $RepoRoot 'scripts\m5-mocha-ae-effect-controls-tab-target.py'
$TabClickScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-guarded-effect-controls-tab-click.ps1'
$ClickScript=Join-Path $RepoRoot 'scripts\windows\m5-mocha-ae-guarded-launch-click.ps1'
$DialogEvidenceScript=Join-Path $RepoRoot 'scripts\windows\m5-ae-dialog-evidence.ps1'
$StatePath=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-isolation-state.json'
$BackupStatePath=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-isolation-state-backup.json'
$SourceMarker=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-source.json'
$EnterMarker=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-isolation-enter.json'
$FixtureInput=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-fixture-input.json'
$FixtureMarker=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-fixture-result.json'
$ControlsMarker=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-effect-controls.json'
$RestoreMarker=Join-Path $env:TEMP 'EditFlow2-m5-mocha-ae-isolation-restore.json'
$Utf8NoBom=New-Object Text.UTF8Encoding($false)
function Wait-JsonMarker([string]$Path,[int]$Seconds,[string]$Label){
  $d=(Get-Date).AddSeconds($Seconds)
  while((Get-Date)-lt$d -and -not(Test-Path $Path -PathType Leaf)){Start-Sleep -Milliseconds 50}
  if(-not(Test-Path $Path -PathType Leaf)){throw "$Label timed out waiting for $Path"}
  $r=(Get-Date).AddSeconds(3)
  while((Get-Date)-lt$r){try{return ([IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8)|ConvertFrom-Json)}catch{Start-Sleep -Milliseconds 25}}
  throw "$Label marker was not valid JSON: $Path"
}
function Invoke-AeTimed([string]$ScriptPath,[string]$MarkerPath,[string]$Label){
  Remove-Item $MarkerPath -Force -ErrorAction SilentlyContinue
  $sw=[Diagnostics.Stopwatch]::StartNew()
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$ScriptPath) -PassThru)
  $value=Wait-JsonMarker $MarkerPath $TimeoutSeconds $Label
  $sw.Stop()
  [pscustomobject]@{value=$value;roundtripMs=[Math]::Round($sw.Elapsed.TotalMilliseconds,3)}
}
function Capture-And-Target([string]$Name){
  $png=Join-Path $ArtifactDir ($Name+'.png'); $json=Join-Path $ArtifactDir ($Name+'.target.json')
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutputPath $png | Out-Null
  if($LASTEXITCODE -ne 0){throw "screen capture failed: $Name"}
  python $TargetScript --image $png --result $json | Out-Null
  if($LASTEXITCODE -ne 0){throw "Mocha visual target grounding failed: $Name"}
  $target=[IO.File]::ReadAllText($json,[Text.Encoding]::UTF8)|ConvertFrom-Json
  if($target.verified -ne $true){throw "Mocha visual target was not verified: $Name"}
  [pscustomobject]@{image=$png;targetPath=$json;target=$target}
}
$Classification='INFRASTRUCTURE_FAILURE'; $Message='M5 Mocha AE launch proof did not complete.'
$MutationStarted=$false; $CleanupComplete=$false; $RestoreAttempted=$false; $ForcedMochaClose=$false
$BaselineAePids=@(); $AfterAePids=@(); $BaselineMochaPids=@(); $LaunchedMocha=$null; $MochaIdentity=$null
$Source=$null; $Enter=$null; $Fixture=$null; $Controls=$null; $Restore=$null; $Click=$null
$SourceMs=$null; $EnterMs=$null; $ApplyMs=$null; $ControlsMs=$null; $ControlsActivationMs=$null; $ControlsTabClickMs=$null; $RestoreMs=$null; $ClickToWindowMs=$null
$PrimaryFailure=$null; $RestoreFailure=$null; $ClickIssued=$false
$LaunchVerified=$false; $TargetStabilityPx=$null; $TargetAreaDelta=$null
try{
  foreach($required in @($AfterFxPath,$SourceProbe,$EnterScript,$FixtureScript,$ControlsScript,$ActivateControlsScript,$RestoreScript,$CaptureScript,$TargetScript,$TabTargetScript,$TabClickScript,$ClickScript,$DialogEvidenceScript)){
    if(-not(Test-Path $required -PathType Leaf)){throw "Required launch proof file missing: $required"}
  }
  $ae=@(Get-Process AfterFX -ErrorAction SilentlyContinue)
  if($ae.Count -ne 1){throw "Launch proof requires exactly one running After Effects process; found $($ae.Count)."}
  if(-not $ae[0].Responding -or $ae[0].MainWindowHandle -eq 0){throw 'After Effects is not a responsive visible target.'}
  $BaselineAePids=@($ae|ForEach-Object Id|Sort-Object)
  $BaselineMochaPids=@(Get-Process mocha4ae_adobe -ErrorAction SilentlyContinue|ForEach-Object Id|Sort-Object)
  if($BaselineMochaPids.Count -ne 0){throw 'Launch proof refuses to run while a pre-existing Mocha AE process is open.'}
  Remove-Item $StatePath,$BackupStatePath,$SourceMarker,$EnterMarker,$FixtureInput,$FixtureMarker,$ControlsMarker,$RestoreMarker -Force -ErrorAction SilentlyContinue
  $run=Invoke-AeTimed $SourceProbe $SourceMarker 'Mocha source probe'; $Source=$run.value; $SourceMs=$run.roundtripMs
  if($Source.ok -ne $true -or -not $Source.sourcePath){throw "Mocha source probe refused: $($Source.failure)"}
  $run=Invoke-AeTimed $EnterScript $EnterMarker 'Mocha isolation entry'; $Enter=$run.value; $EnterMs=$run.roundtripMs
  if($Enter.version -ne 'M5_MOCHA_AE_ISOLATION_V1' -or $Enter.ok -ne $true){throw "Mocha isolation entry refused: $($Enter.failure)"}
  $Classification='PRODUCT_FAILURE'
  [IO.File]::WriteAllText($FixtureInput,((@{sourcePath=[string]$Source.sourcePath}|ConvertTo-Json)+[Environment]::NewLine),$Utf8NoBom)
  $run=Invoke-AeTimed $FixtureScript $FixtureMarker 'Mocha effect apply'; $Fixture=$run.value; $ApplyMs=$run.roundtripMs; $MutationStarted=[bool]$Fixture.mutationStarted
  if($Fixture.ok -ne $true -or [string]$Fixture.effectMatchName -ne 'mochaAECC'){throw "Mocha effect apply refused: $($Fixture.failure)"}
  $run=Invoke-AeTimed $ControlsScript $ControlsMarker 'Mocha Effect Controls prepare'; $Controls=$run.value; $ControlsMs=$run.roundtripMs
  if($Controls.ok -ne $true -or [string]$Controls.effectMatchName -ne 'mochaAECC'){throw "Mocha Effect Controls preparation refused: $($Controls.failure)"}
  $activateResult=Join-Path $ArtifactDir 'effect-controls-activate.json'; Remove-Item $activateResult -Force -ErrorAction SilentlyContinue
  $activateSw=[Diagnostics.Stopwatch]::StartNew()
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ActivateControlsScript -AfterFxPid $BaselineAePids[0] -ResultPath $activateResult | Out-Null
  $activateSw.Stop(); $ControlsActivationMs=[Math]::Round($activateSw.Elapsed.TotalMilliseconds,3)
  if($LASTEXITCODE -ne 0){throw 'F3 Effect Controls activation failed.'}
  $ControlsTabActivationMode='F3_ALREADY_ACTIVE'
  $panelPrePng=Join-Path $ArtifactDir 'effect-controls-tab-pre.png'; $panelLaunchJson=Join-Path $ArtifactDir 'effect-controls-tab-pre.launch.json'
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutputPath $panelPrePng | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Effect Controls pre-activation capture failed.'}
  python $TargetScript --image $panelPrePng --result $panelLaunchJson | Out-Null
  if($LASTEXITCODE -eq 0){
    $panelTarget=[IO.File]::ReadAllText($panelLaunchJson,[Text.Encoding]::UTF8)|ConvertFrom-Json
    $pre=[pscustomobject]@{image=$panelPrePng;targetPath=$panelLaunchJson;target=$panelTarget}
  }else{
    $ControlsTabActivationMode='GUARDED_TAB_CLICK'
    $tabJson=Join-Path $ArtifactDir 'effect-controls-tab-pre.target.json'
    python $TabTargetScript --image $panelPrePng --result $tabJson | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Neither Mocha launch target nor bounded Effect Controls tab target was verified.'}
    $tabClickResult=Join-Path $ArtifactDir 'effect-controls-tab-click.json'
    $tabSw=[Diagnostics.Stopwatch]::StartNew()
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TabClickScript -AfterFxPid $BaselineAePids[0] -TargetJson $tabJson -ResultPath $tabClickResult | Out-Null
    $tabSw.Stop(); $ControlsTabClickMs=[Math]::Round($tabSw.Elapsed.TotalMilliseconds,3)
    if($LASTEXITCODE -ne 0){throw 'Guarded Effect Controls tab activation failed.'}
    Start-Sleep -Milliseconds 120
    $pre=Capture-And-Target 'launch-pre'
  }
  Start-Sleep -Milliseconds 80; $fresh=Capture-And-Target 'launch-action'
  $dx=[double]$fresh.target.target.x-[double]$pre.target.target.x; $dy=[double]$fresh.target.target.y-[double]$pre.target.target.y
  $TargetStabilityPx=[Math]::Round([Math]::Sqrt($dx*$dx+$dy*$dy),3)
  $a0=[double]$pre.target.target.area; $a1=[double]$fresh.target.target.area; $TargetAreaDelta=[Math]::Round([Math]::Abs($a1-$a0)/[Math]::Max(1,$a0),4)
  if($TargetStabilityPx -gt 2 -or $TargetAreaDelta -gt 0.15){throw "Mocha visual launch target changed before action."}
  $clickResult=Join-Path $ArtifactDir 'launch-click.json'
  $launchSw=[Diagnostics.Stopwatch]::StartNew()
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ClickScript -AfterFxPid $BaselineAePids[0] -TargetJson $fresh.targetPath -ResultPath $clickResult | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Guarded Mocha launch click failed.'}
  $ClickIssued=$true
  $Click=[IO.File]::ReadAllText($clickResult,[Text.Encoding]::UTF8)|ConvertFrom-Json
  Start-Sleep -Milliseconds 500
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutputPath (Join-Path $ArtifactDir 'launch-after-click.png') | Out-Null
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $DialogEvidenceScript -AfterFxPid $BaselineAePids[0] -ResultPath (Join-Path $ArtifactDir 'launch-after-click-windows.json') | Out-Null
  $deadline=(Get-Date).AddSeconds([Math]::Min(30,$TimeoutSeconds))
  do{
    Start-Sleep -Milliseconds 100
    $mocha=@(Get-Process mocha4ae_adobe -ErrorAction SilentlyContinue)
    if($mocha.Count -eq 1 -and $mocha[0].MainWindowHandle -ne 0 -and $mocha[0].Responding){$LaunchedMocha=$mocha[0];break}
    if($mocha.Count -gt 1){throw 'More than one Mocha AE process appeared after the guarded launch action.'}
  }while((Get-Date)-lt$deadline)
  $launchSw.Stop(); $ClickToWindowMs=[Math]::Round($launchSw.Elapsed.TotalMilliseconds,3)
  if($null -eq $LaunchedMocha){throw 'Verified launch action did not produce one responsive Mocha AE window before timeout.'}
  $exePath=[string]$LaunchedMocha.Path
  if(-not $exePath){throw 'Mocha AE executable path was unavailable.'}
  $file=Get-Item $exePath -ErrorAction Stop; $vi=$file.VersionInfo
  $title=[string]$LaunchedMocha.MainWindowTitle
  $expectedExe='C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\Plug-ins\Effects\mochaAE\MochaAE.bundle\Contents\Win64\mochaui\bin\mocha4ae_adobe.exe'
  if(-not [string]::Equals($exePath,$expectedExe,[StringComparison]::OrdinalIgnoreCase)){throw "Unexpected Mocha executable path: $exePath"}
  if([string]$vi.CompanyName -notmatch '(?i)Boris FX'){throw "Unexpected Mocha executable company: $($vi.CompanyName)"}
  if([string]$vi.FileVersion -notmatch '^12\.2'){throw "Unexpected Mocha executable version: $($vi.FileVersion)"}
  if($title -notmatch '(?i)mocha'){throw "Mocha process window title did not identify Mocha: $title"}
  if($title -match '(?i)license|activation|error|warning'){throw "Unexpected Mocha launch state: $title"}
  $MochaIdentity=[ordered]@{pid=$LaunchedMocha.Id;path=$exePath;title=$title;fileVersion=[string]$vi.FileVersion;productVersion=[string]$vi.ProductVersion;company=[string]$vi.CompanyName;productName=[string]$vi.ProductName;mainWindowHandle=[int64]$LaunchedMocha.MainWindowHandle}
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutputPath (Join-Path $ArtifactDir 'launch-post.png') | Out-Null
  $LaunchVerified=$true
  $closeRequested=$LaunchedMocha.CloseMainWindow()
  $closeDeadline=(Get-Date).AddSeconds(8)
  while((Get-Date)-lt$closeDeadline -and (Get-Process -Id $LaunchedMocha.Id -ErrorAction SilentlyContinue)){Start-Sleep -Milliseconds 100}
  if(Get-Process -Id $LaunchedMocha.Id -ErrorAction SilentlyContinue){
    $ForcedMochaClose=$true
    Stop-Process -Id $LaunchedMocha.Id -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 250
  }
  if(Get-Process -Id $LaunchedMocha.Id -ErrorAction SilentlyContinue){throw 'Proof-owned Mocha AE process did not close.'}
}catch{
  $PrimaryFailure=$_.Exception.Message
}finally{
  if($ClickIssued -eq $true){
    $remaining=@(Get-Process mocha4ae_adobe -ErrorAction SilentlyContinue)
    if($remaining.Count -eq 1){
      try{
        $rp=$remaining[0]; $rpath=[string]$rp.Path
        if($rpath -and $rpath -match '(?i)\\mocha4ae_adobe\.exe$'){
          [void]$rp.CloseMainWindow(); Start-Sleep -Milliseconds 500
          if(Get-Process -Id $rp.Id -ErrorAction SilentlyContinue){$ForcedMochaClose=$true; Stop-Process -Id $rp.Id -Force -ErrorAction Stop; Start-Sleep -Milliseconds 200}
        }
      }catch{}
    }
  }
  if((Test-Path $StatePath -PathType Leaf) -or (Test-Path $BackupStatePath -PathType Leaf)){
    $RestoreAttempted=$true
    try{
      $run=Invoke-AeTimed $RestoreScript $RestoreMarker 'Mocha isolation restore'; $Restore=$run.value; $RestoreMs=$run.roundtripMs
      if($Restore.version -ne 'M5_MOCHA_AE_ISOLATION_V1' -or $Restore.ok -ne $true){throw "Mocha isolation restore refused: $($Restore.failure)"}
    }catch{$RestoreFailure=$_.Exception.Message}
  }
  $AfterAePids=@(Get-Process AfterFX -ErrorAction SilentlyContinue|ForEach-Object Id|Sort-Object)
  $SameAeProcess=(($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
  $MochaRemaining=@(Get-Process mocha4ae_adobe -ErrorAction SilentlyContinue|ForEach-Object Id|Sort-Object)
  $CleanupComplete=$RestoreAttempted -and $null -ne $Restore -and $Restore.ok -eq $true -and $MochaRemaining.Count -eq 0 -and $SameAeProcess
  $warm=@($SourceMs,$EnterMs,$ApplyMs,$ControlsMs,$ControlsActivationMs,$ControlsTabClickMs,$RestoreMs)|Where-Object{$null -ne $_}
  $MaxWarmMs=if($warm.Count){[Math]::Round(($warm|Measure-Object -Maximum).Maximum,3)}else{$null}
  if($null -eq $PrimaryFailure -and $null -eq $RestoreFailure -and $LaunchVerified -and $CleanupComplete -and $MaxWarmMs -le 3000){
    $Classification='PASS'; $Message='Mocha AE guarded visual launch, Boris FX session identity, proof-owned close, exact project restore, and warm-process reuse passed.'
  }elseif($null -ne $RestoreFailure){$Message=$RestoreFailure}
  elseif($null -ne $PrimaryFailure){$Message=$PrimaryFailure}
  elseif(-not $CleanupComplete){$Message='Mocha launch proof cleanup or exact AE restoration did not complete.'}
  elseif($MaxWarmMs -gt 3000){$Message="Warm AE roundtrip ceiling exceeded: $MaxWarmMs ms"}
  $Result=[ordered]@{
    proofId='M5_MOCHA_AE_LAUNCH_REAL_AE_V1';classification=$Classification;ok=($Classification -eq 'PASS');message=$Message
    mutationStarted=$MutationStarted;cleanupComplete=$CleanupComplete;launchVerified=$LaunchVerified;forcedMochaClose=$ForcedMochaClose
    baselineAePids=$BaselineAePids;afterAePids=$AfterAePids;sameAeProcess=$SameAeProcess;baselineMochaPids=$BaselineMochaPids;remainingMochaPids=$MochaRemaining
    sourceProbeRoundtripMs=$SourceMs;isolationEnterRoundtripMs=$EnterMs;effectApplyRoundtripMs=$ApplyMs;effectControlsRoundtripMs=$ControlsMs;effectControlsActivationMs=$ControlsActivationMs;effectControlsTabClickMs=$ControlsTabClickMs;restoreRoundtripMs=$RestoreMs;maxMeasuredWarmAeRoundtripMs=$MaxWarmMs;clickToMochaWindowMs=$ClickToWindowMs
    effectControlsActivationMode=$ControlsTabActivationMode;targetStabilityPx=$TargetStabilityPx;targetAreaDelta=$TargetAreaDelta;click=$Click;mochaIdentity=$MochaIdentity
    source=$Source;enter=$Enter;fixture=$Fixture;controls=$Controls;restore=$Restore;primaryFailure=$PrimaryFailure;restoreFailure=$RestoreFailure
  }
  [IO.File]::WriteAllText($ResultPath,(($Result|ConvertTo-Json -Depth 40)+[Environment]::NewLine),$Utf8NoBom)
}
if($Classification -ne 'PASS'){Write-Error $Message;exit 1}
Write-Host $Message
Write-Host ("Result: "+$ResultPath)
Write-Host ("Warm max: "+$MaxWarmMs+" ms; click-to-Mocha-window: "+$ClickToWindowMs+" ms")
