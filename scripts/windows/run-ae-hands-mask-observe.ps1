param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=120)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Write-Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$true;cleanupComplete=$true;proofKind='AE_HANDS_MASK_OBSERVE'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
  $resolved=(Resolve-Path $AfterFxPath).Path;$targets=HealthyAe $resolved;if($targets.Count-ne1){throw "Expected one healthy AE process, found $($targets.Count)."};$ae=$targets[0];$pid0=[int]$ae.Id
  $python=(Get-Command python -ErrorAction Stop|Select-Object -First 1).Source
  $cli=Join-Path $RepoRoot 'tools\ae-hands\ae_hands_cli.py'
  if(-not(Test-Path $cli)){throw 'AE Hands CLI is missing.'}
  $winapp=Get-Command winapp -ErrorAction SilentlyContinue|Select-Object -First 1
  if(-not$winapp){throw 'winapp CLI is required and was not found.'}

  Add-Type -AssemblyName System.Drawing
  $fixture=Join-Path $ArtifactDir 'mask-fixture.png'
  $bmp=New-Object System.Drawing.Bitmap 640,360
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  try{
    $g.Clear([System.Drawing.Color]::FromArgb(24,30,38))
    $brush=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(246,196,42))
    try{$g.FillRectangle($brush,190,105,260,150)}finally{$brush.Dispose()}
    $pen=New-Object System.Drawing.Pen ([System.Drawing.Color]::White),4
    try{$g.DrawRectangle($pen,190,105,260,150)}finally{$pen.Dispose()}
    $bmp.Save($fixture,[System.Drawing.Imaging.ImageFormat]::Png)
  }finally{$g.Dispose();$bmp.Dispose()}

  $escaped=$fixture.Replace('\','/').Replace("'","\\'")
  $setup=Join-Path $ArtifactDir 'setup-mask-fixture.jsx'
  $jsx=@"
(function(){
 var p=app.project;if(!p){p=app.newProject();}
 for(var i=p.numItems;i>=1;i--){var it=p.item(i);if(it.name==='__GPT_HANDS_MASK_TEST__'||it.name==='__GPT_HANDS_MASK_FIXTURE__'){try{it.remove();}catch(e){}}}
 var f=new File('$escaped');if(!f.exists){throw new Error('fixture missing');}
 var ft=p.importFile(new ImportOptions(f));ft.name='__GPT_HANDS_MASK_FIXTURE__';
 var c=p.items.addComp('__GPT_HANDS_MASK_TEST__',640,360,1,5,30);
 var l=c.layers.add(ft);l.name='__GPT_HANDS_TARGET_LAYER__';l.selected=true;c.time=0;c.openInViewer();
})();
"@
  [IO.File]::WriteAllText($setup,$jsx,(New-Object Text.UTF8Encoding($false)))
  $launch=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$setup) -PassThru
  try{Wait-Process -Id $launch.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{}
  Start-Sleep -Seconds 3

  $shot=Join-Path $ArtifactDir 'gpt-eyes-before-mask.png';$tree=Join-Path $ArtifactDir 'gpt-ui-tree-before-mask.txt';$obs=Join-Path $ArtifactDir 'observe.json'
  & $python $cli observe --screenshot $shot --tree $tree --depth 7 | Out-File $obs -Encoding utf8
  if($LASTEXITCODE-ne0){throw 'AE Hands observe command failed.'}
  if(-not(Test-Path $shot)-or(Get-Item $shot).Length-lt10000){throw 'AE Hands did not produce a usable screenshot.'}
  $after=HealthyAe $resolved;$same=($after.Count-eq1-and[int]$after[0].Id-eq$pid0)
  if(-not$same){throw 'AE process changed during observation.'}
  Write-Result 'PASS' 'AE Hands observation fixture is live; GPT can choose mask points from the captured AE view.' @{aePid=$pid0;screenshot='gpt-eyes-before-mask.png';uiTree='gpt-ui-tree-before-mask.txt';fixture='mask-fixture.png';objectCompRect=@{left=190;top=105;right=450;bottom=255};fixturePersistent=$true;warmAePreserved=$true}
  exit 0
}catch{Write-Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
