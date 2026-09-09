param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=90)
$ErrorActionPreference='Stop'
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$false;cleanupComplete=$true;proofKind='AE_HANDS_MASK_STRUCTURAL_VERIFY'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 16)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
 $resolved=(Resolve-Path $AfterFxPath).Path;$t=HealthyAe $resolved;if($t.Count-ne1){throw "Expected one healthy AE process, found $($t.Count)."};$pid0=[int]$t[0].Id
 $out=Join-Path $ArtifactDir 'mask-structure.json';$jsx=Join-Path $ArtifactDir 'verify-mask.jsx'
 $escaped=$out.Replace('\','/').Replace("'","\\'")
 $code=@"
(function(){
 var out=new File('$escaped');var r={ok:false,compFound:false,layerFound:false,maskCount:0,masks:[]};
 try{
  var p=app.project;if(!p){throw new Error('no project');}
  var c=null;for(var i=1;i<=p.numItems;i++){var it=p.item(i);if(it.name==='__GPT_HANDS_MASK_TEST__'){c=it;break;}}
  if(!c){throw new Error('test comp not found');}r.compFound=true;
  var l=null;for(var j=1;j<=c.numLayers;j++){if(c.layer(j).name==='__GPT_HANDS_TARGET_LAYER__'){l=c.layer(j);break;}}
  if(!l){throw new Error('target layer not found');}r.layerFound=true;
  var g=l.property('ADBE Mask Parade');r.maskCount=g?g.numProperties:0;
  for(var k=1;k<=r.maskCount;k++){
    var mg=g.property(k);var shp=mg.property('ADBE Mask Shape').value;
    var verts=[];for(var v=0;v<shp.vertices.length;v++){verts.push([shp.vertices[v][0],shp.vertices[v][1]]);}
    r.masks.push({index:k,name:mg.name,closed:shp.closed,vertexCount:verts.length,vertices:verts,mode:String(mg.maskMode)});
  }
  r.ok=true;
 }catch(e){r.error=String(e);}
 out.encoding='UTF-8';out.open('w');out.write(JSON.stringify(r));out.close();
})();
"@
 [IO.File]::WriteAllText($jsx,$code,(New-Object Text.UTF8Encoding($false)))
 $launch=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$jsx) -PassThru;try{Wait-Process -Id $launch.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
 $deadline=(Get-Date).AddSeconds(15);while(-not(Test-Path $out)-and(Get-Date)-lt$deadline){Start-Sleep -Milliseconds 200}
 if(-not(Test-Path $out)){throw 'AE did not produce mask structural readback.'}
 $s=Get-Content $out -Raw|ConvertFrom-Json
 $after=HealthyAe $resolved;$warm=($after.Count-eq1-and[int]$after[0].Id-eq$pid0)
 $extra=@{aePid=$pid0;warmAePreserved=$warm;maskCount=[int]$s.maskCount;masks=$s.masks;structureFile='mask-structure.json'}
 if(-not[bool]$s.ok){Result 'PRODUCT_FAILURE' "Mask readback failed: $($s.error)" $extra;exit 1}
 if([int]$s.maskCount-lt1){Result 'PRODUCT_FAILURE' 'No native AE mask exists on the target layer after the generic Hands gesture.' $extra;exit 1}
 $first=$s.masks[0];if(-not[bool]$first.closed-or[int]$first.vertexCount-lt3){Result 'PRODUCT_FAILURE' 'A mask exists, but it is not a valid closed polygon.' $extra;exit 1}
 if(-not$warm){Result 'PRODUCT_FAILURE' 'Mask exists but the warm AE process was not preserved.' $extra;exit 1}
 Result 'PASS' 'Generic AE Hands created a native closed mask; structural readback confirms its geometry.' $extra;exit 0
}catch{Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
