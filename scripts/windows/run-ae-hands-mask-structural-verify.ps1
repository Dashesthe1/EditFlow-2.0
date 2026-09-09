param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=90)
$ErrorActionPreference='Stop'
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$false;cleanupComplete=$true;proofKind='AE_HANDS_MASK_STRUCTURAL_VERIFY'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 16)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
 $resolved=(Resolve-Path $AfterFxPath).Path;$t=HealthyAe $resolved;if($t.Count-ne1){throw "Expected one healthy AE process, found $($t.Count)."};$pid0=[int]$t[0].Id
 $out=Join-Path $ArtifactDir 'mask-structure.txt';$jsx=Join-Path $ArtifactDir 'verify-mask.jsx'
 $escaped=$out.Replace('\','/').Replace("'","\\'")
 $code=@"
(function(){
 var out=new File('$escaped');var lines=[];
 try{
  var p=app.project;if(!p){throw new Error('no project');}
  var c=null;for(var i=1;i<=p.numItems;i++){var it=p.item(i);if(it.name==='__GPT_HANDS_MASK_TEST__'){c=it;break;}}
  if(!c){throw new Error('test comp not found');}lines.push('COMP\t1');
  var l=null;for(var j=1;j<=c.numLayers;j++){if(c.layer(j).name==='__GPT_HANDS_TARGET_LAYER__'){l=c.layer(j);break;}}
  if(!l){throw new Error('target layer not found');}lines.push('LAYER\t1');
  var g=l.property('ADBE Mask Parade');var count=g?g.numProperties:0;lines.push('MASKCOUNT\t'+count);
  for(var k=1;k<=count;k++){
   var mg=g.property(k);var shp=mg.property('ADBE Mask Shape').value;var vs=[];
   for(var v=0;v<shp.vertices.length;v++){vs.push(shp.vertices[v][0]+','+shp.vertices[v][1]);}
   lines.push('MASK\t'+k+'\t'+mg.name+'\t'+(shp.closed?'1':'0')+'\t'+shp.vertices.length+'\t'+vs.join(';'));
  }
  lines.push('OK\t1');
 }catch(e){lines.push('ERROR\t'+String(e).replace(/[\r\n\t]/g,' '));lines.push('OK\t0');}
 out.encoding='UTF-8';out.open('w');out.write(lines.join('\n'));out.close();
})();
"@
 [IO.File]::WriteAllText($jsx,$code,(New-Object Text.UTF8Encoding($false)))
 $launch=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$jsx) -PassThru;try{Wait-Process -Id $launch.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
 $deadline=(Get-Date).AddSeconds(15);while(((-not(Test-Path $out))-or(Get-Item $out -ErrorAction SilentlyContinue).Length-eq0)-and(Get-Date)-lt$deadline){Start-Sleep -Milliseconds 200}
 if(-not(Test-Path $out)-or(Get-Item $out).Length-eq0){throw 'AE did not produce non-empty mask structural readback.'}
 $lines=@(Get-Content $out);$ok=$false;$maskCount=0;$masks=@();$errorText=''
 foreach($line in $lines){
  $parts=$line -split "`t"
  if($parts[0]-eq'OK'){$ok=($parts[1]-eq'1')}
  elseif($parts[0]-eq'MASKCOUNT'){$maskCount=[int]$parts[1]}
  elseif($parts[0]-eq'ERROR'){$errorText=($parts|Select-Object -Skip 1)-join' '}
  elseif($parts[0]-eq'MASK'){
   $verts=@();if($parts.Count-ge6-and$parts[5]){foreach($pair in ($parts[5]-split';')){$xy=$pair-split',';if($xy.Count-eq2){$verts+=,@([double]$xy[0],[double]$xy[1])}}}
   $masks+=,[pscustomobject]@{index=[int]$parts[1];name=$parts[2];closed=($parts[3]-eq'1');vertexCount=[int]$parts[4];vertices=$verts}
  }
 }
 $after=HealthyAe $resolved;$warm=($after.Count-eq1-and[int]$after[0].Id-eq$pid0)
 $extra=@{aePid=$pid0;warmAePreserved=$warm;maskCount=$maskCount;masks=$masks;structureFile='mask-structure.txt'}
 if(-not$ok){Result 'PRODUCT_FAILURE' "Mask readback failed: $errorText" $extra;exit 1}
 if($maskCount-lt1){Result 'PRODUCT_FAILURE' 'No native AE mask exists on the target layer after the generic Hands gesture.' $extra;exit 1}
 $first=$masks[0];if(-not[bool]$first.closed-or[int]$first.vertexCount-lt3){Result 'PRODUCT_FAILURE' 'A mask exists, but it is not a valid closed polygon.' $extra;exit 1}
 if(-not$warm){Result 'PRODUCT_FAILURE' 'Mask exists but the warm AE process was not preserved.' $extra;exit 1}
 Result 'PASS' 'Generic AE Hands created a native closed mask; structural readback confirms its geometry.' $extra;exit 0
}catch{Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
