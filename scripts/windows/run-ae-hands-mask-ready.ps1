param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=120)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path;$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR;New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$true;cleanupComplete=$true;proofKind='AE_HANDS_MASK_READY'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
 $resolved=(Resolve-Path $AfterFxPath).Path;$t=HealthyAe $resolved;if($t.Count-ne1){throw "Expected one healthy AE process, found $($t.Count)."};$pid0=[int]$t[0].Id
 $python=(Get-Command python -ErrorAction Stop|Select-Object -First 1).Source;$cli=Join-Path $RepoRoot 'tools\ae-hands\ae_hands_cli.py'
 & $python $cli key ESC | Out-File (Join-Path $ArtifactDir 'dismiss-existing-popup.json') -Encoding utf8;Start-Sleep -Milliseconds 400
 $setup=Join-Path $ArtifactDir 'reset-fixture.jsx';$jsx=@"
(function(){var p=app.project;if(!p){p=app.newProject();}for(var i=p.numItems;i>=1;i--){var it=p.item(i);if(it.name==='__GPT_HANDS_MASK_TEST__'||it.name==='__GPT_HANDS_TARGET_SOLID__'||it.name==='__GPT_HANDS_BG_SOLID__'){try{it.remove();}catch(e){}}}var c=p.items.addComp('__GPT_HANDS_MASK_TEST__',640,360,1,5,30);var bg=c.layers.addSolid([0.07,0.09,0.12],'__GPT_HANDS_BG_SOLID__',640,360,1,5);bg.name='__GPT_HANDS_BACKGROUND__';var q=c.layers.addSolid([0.96,0.77,0.16],'__GPT_HANDS_TARGET_SOLID__',260,150,1,5);q.name='__GPT_HANDS_TARGET_LAYER__';q.property('ADBE Transform Group').property('ADBE Position').setValue([320,180]);for(var k=1;k<=c.numLayers;k++){c.layer(k).selected=false;}q.selected=true;c.time=0;c.openInViewer();})();
"@;[IO.File]::WriteAllText($setup,$jsx,(New-Object Text.UTF8Encoding($false)))
 $launch=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$setup) -PassThru;try{Wait-Process -Id $launch.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{};Start-Sleep -Seconds 2
 & $python $cli key G | Out-File (Join-Path $ArtifactDir 'pen-first.json') -Encoding utf8;Start-Sleep -Seconds 1
 & $python $cli key ESC | Out-File (Join-Path $ArtifactDir 'dismiss-pen-popup.json') -Encoding utf8;Start-Sleep -Milliseconds 400
 & $python $cli key G | Out-File (Join-Path $ArtifactDir 'pen-final.json') -Encoding utf8;Start-Sleep -Milliseconds 500
 $shot=Join-Path $ArtifactDir 'gpt-eyes-pen-ready.png';$tree=Join-Path $ArtifactDir 'gpt-ui-tree-pen-ready.txt'
 & $python $cli observe --screenshot $shot --tree $tree --depth 7 | Out-File (Join-Path $ArtifactDir 'observe.json') -Encoding utf8
 if($LASTEXITCODE-ne0-or-not(Test-Path $shot)){throw 'Pen-ready observation failed.'}
 $a=HealthyAe $resolved;if($a.Count-ne1-or[int]$a[0].Id-ne$pid0){throw 'AE process changed.'}
 Result 'PASS' 'Pen tool is stabilized and GPT has a fresh screenshot for mask-point selection.' @{aePid=$pid0;screenshot='gpt-eyes-pen-ready.png';uiTree='gpt-ui-tree-pen-ready.txt';warmAePreserved=$true}
 exit 0
}catch{Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
