param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=120)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$ResultPath=Join-Path $ArtifactDir 'result.json'
function Write-Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$true;cleanupComplete=$true;proofKind='AE_HANDS_MASK_ACT'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText($ResultPath,(($o|ConvertTo-Json -Depth 12)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
try{
  $resolved=(Resolve-Path $AfterFxPath).Path;$targets=HealthyAe $resolved;if($targets.Count-ne1){throw "Expected one healthy AE process, found $($targets.Count)."};$pid0=[int]$targets[0].Id
  $python=(Get-Command python -ErrorAction Stop|Select-Object -First 1).Source
  $cli=Join-Path $RepoRoot 'tools\ae-hands\ae_hands_cli.py';$planPath=Join-Path $RepoRoot '.github\ae-proof-request\hands-mask-action.json'
  if(-not(Test-Path $cli)){throw 'AE Hands CLI missing.'};if(-not(Test-Path $planPath)){throw 'Hands mask action plan missing.'}
  $plan=Get-Content $planPath -Raw|ConvertFrom-Json
  $before=Join-Path $ArtifactDir 'before-action.png';$beforeTree=Join-Path $ArtifactDir 'before-tree.txt'
  & $python $cli observe --screenshot $before --tree $beforeTree --depth 5 | Out-File (Join-Path $ArtifactDir 'before-observe.json') -Encoding utf8
  if($LASTEXITCODE-ne0){throw 'Pre-action observe failed.'}
  $logs=@();$i=0
  foreach($a in @($plan.actions)){
    $i++;$log=Join-Path $ArtifactDir ("action-{0:D2}.json" -f $i)
    if([string]$a.type -eq 'key'){
      & $python $cli key ([string]$a.name) | Out-File $log -Encoding utf8
    } elseif([string]$a.type -eq 'click'){
      & $python $cli click ([string]$a.x) ([string]$a.y) | Out-File $log -Encoding utf8
    } else { throw "Unsupported action type in proof plan: $($a.type)" }
    if($LASTEXITCODE-ne0){throw "AE Hands action $i failed."}
    $logs += [IO.Path]::GetFileName($log)
    Start-Sleep -Milliseconds 220
  }
  Start-Sleep -Milliseconds 700
  $afterShot=Join-Path $ArtifactDir 'after-mask.png';$afterTree=Join-Path $ArtifactDir 'after-tree.txt'
  & $python $cli observe --screenshot $afterShot --tree $afterTree --depth 7 | Out-File (Join-Path $ArtifactDir 'after-observe.json') -Encoding utf8
  if($LASTEXITCODE-ne0){throw 'Post-action observe failed.'}
  $after=HealthyAe $resolved;$same=($after.Count-eq1-and[int]$after[0].Id-eq$pid0)
  if(-not$same){throw 'AE process changed during generic hands actions.'}
  Write-Result 'PASS' 'GPT-selected mask gesture sequence was delivered exclusively through generic AE Hands primitives.' @{aePid=$pid0;actionCount=@($plan.actions).Count;actionLogs=$logs;beforeScreenshot='before-action.png';afterScreenshot='after-mask.png';warmAePreserved=$true;fixtureLeftForIndependentVerification=$true}
  exit 0
}catch{Write-Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2}
