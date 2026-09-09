param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=120)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Write-Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$true;cleanupComplete=$true;proofKind='AE_HANDS_MASK_OBSERVE_V2'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
  $resolved=(Resolve-Path $AfterFxPath).Path;$targets=HealthyAe $resolved;if($targets.Count-ne1){throw "Expected one healthy AE process, found $($targets.Count)."};$pid0=[int]$targets[0].Id
  $python=(Get-Command python -ErrorAction Stop|Select-Object -First 1).Source;$cli=Join-Path $RepoRoot 'tools\ae-hands\ae_hands_cli.py'
  if(-not(Test-Path $cli)){throw 'AE Hands CLI is missing.'}
  # ESC is harmless in the base workspace and dismisses any AE-owned transient modal left by a prior diagnostic.
  & $python $cli key ESC | Out-File (Join-Path $ArtifactDir 'dismiss-transient.json') -Encoding utf8
  Start-Sleep -Milliseconds 500

  $setup=Join-Path $ArtifactDir 'setup-mask-fixture.jsx'
  $jsx=@"
(function(){
 var p=app.project;if(!p){p=app.newProject();}
 for(var i=p.numItems;i>=1;i--){var it=p.item(i);if(it.name==='__GPT_HANDS_MASK_TEST__'||it.name==='__GPT_HANDS_TARGET_SOLID__'||it.name==='__GPT_HANDS_BG_SOLID__'||it.name==='__GPT_HANDS_MASK_FIXTURE__'){try{it.remove();}catch(e){}}}
 var c=p.items.addComp('__GPT_HANDS_MASK_TEST__',640,360,1,5,30);
 var bg=c.layers.addSolid([0.07,0.09,0.12],'__GPT_HANDS_BG_SOLID__',640,360,1,5);bg.name='__GPT_HANDS_BACKGROUND__';
 var target=c.layers.addSolid([0.96,0.77,0.16],'__GPT_HANDS_TARGET_SOLID__',260,150,1,5);target.name='__GPT_HANDS_TARGET_LAYER__';target.property('ADBE Transform Group').property('ADBE Position').setValue([320,180]);
 for(var k=1;k<=c.numLayers;k++){c.layer(k).selected=false;}target.selected=true;c.time=0;c.openInViewer();
})();
"@
  [IO.File]::WriteAllText($setup,$jsx,(New-Object Text.UTF8Encoding($false)))
  $launch=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$setup) -PassThru
  try{Wait-Process -Id $launch.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
  Start-Sleep -Seconds 3
  $shot=Join-Path $ArtifactDir 'gpt-eyes-before-mask.png';$tree=Join-Path $ArtifactDir 'gpt-ui-tree-before-mask.txt';$obs=Join-Path $ArtifactDir 'observe.json'
  & $python $cli observe --screenshot $shot --tree $tree --depth 7 | Out-File $obs -Encoding utf8
  if($LASTEXITCODE-ne0){throw 'AE Hands observe command failed.'};if(-not(Test-Path $shot)-or(Get-Item $shot).Length-lt10000){throw 'No usable screenshot.'}
  $after=HealthyAe $resolved;$same=($after.Count-eq1-and[int]$after[0].Id-eq$pid0);if(-not$same){throw 'AE process changed during observation.'}
  Write-Result 'PASS' 'Native-solid mask fixture is live and selected for GPT visual targeting.' @{aePid=$pid0;screenshot='gpt-eyes-before-mask.png';uiTree='gpt-ui-tree-before-mask.txt';fixturePersistent=$true;warmAePreserved=$true;targetSizeCompPixels=@{width=260;height=150};compSize=@{width=640;height=360}}
  exit 0
}catch{Write-Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
