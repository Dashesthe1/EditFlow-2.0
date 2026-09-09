param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=90)
$ErrorActionPreference='Stop'
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
function Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$true;cleanupComplete=$true};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 8)+[Environment]::NewLine))}
try{
 $resolved=(Resolve-Path $AfterFxPath).Path;$targets=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$resolved)-and$p.Responding-and$p.MainWindowHandle-ne0){$targets+=$p}}catch{}}
 if($targets.Count-ne1){throw "Expected one AE process."};$t=$targets[0]
 $winapp=(Get-Command winapp -ErrorAction Stop|Select-Object -First 1).Source
 $before=Join-Path $ArtifactDir 'before.png';$after=Join-Path $ArtifactDir 'after.png';$clean=Join-Path $ArtifactDir 'clean.png'
 & $winapp ui screenshot -a ([string]$t.Id) --output $before --focus 2>&1|Out-File (Join-Path $ArtifactDir 'before.log')
 $jsx=Join-Path $ArtifactDir 'smoke.jsx';$cleanup=Join-Path $ArtifactDir 'cleanup.jsx'
 [IO.File]::WriteAllText($jsx,"(function(){var p=app.project;if(!p){p=app.newProject();}var c=p.items.addComp('__GPT_JSX_SMOKE__',640,360,1,2,30);c.openInViewer();})();")
 [IO.File]::WriteAllText($cleanup,"(function(){var p=app.project;if(!p){return;}for(var i=p.numItems;i>=1;i--){if(p.item(i).name==='__GPT_JSX_SMOKE__'){p.item(i).remove();}}})();")
 $proc=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$jsx) -PassThru
 try{Wait-Process -Id $proc.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
 Start-Sleep -Seconds 3
 & $winapp ui screenshot -a ([string]$t.Id) --output $after --focus 2>&1|Out-File (Join-Path $ArtifactDir 'after.log')
 $p2=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$cleanup) -PassThru
 try{Wait-Process -Id $p2.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
 Start-Sleep -Seconds 2
 & $winapp ui screenshot -a ([string]$t.Id) --output $clean --focus 2>&1|Out-File (Join-Path $ArtifactDir 'clean.log')
 $bh=(Get-FileHash $before -Algorithm SHA256).Hash;$ah=(Get-FileHash $after -Algorithm SHA256).Hash;$ch=(Get-FileHash $clean -Algorithm SHA256).Hash
 $changed=$bh-ne$ah
 if(-not$changed){Result 'PRODUCT_FAILURE' 'AfterFX -r did not visibly change the AE workspace.' @{aePid=[int]$t.Id;before=$bh;after=$ah;clean=$ch};exit 1}
 Result 'PASS' 'AfterFX -r executed in the existing AE process and visibly opened a disposable comp.' @{aePid=[int]$t.Id;before=$bh;after=$ah;clean=$ch};exit 0
}catch{Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{};exit 2}
