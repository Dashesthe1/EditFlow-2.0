param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$MutationStarted = $false
$CleanupComplete = $false

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EFSensesInput {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
 public static void Space(){ keybd_event(0x20,0,0,UIntPtr.Zero); keybd_event(0x20,0,0x0002,UIntPtr.Zero); }
}
"@

function Write-Result([string]$Classification,[string]$Message,[hashtable]$Extra) {
  $o=[ordered]@{classification=$Classification;ok=($Classification-eq'PASS');message=$Message;mutationStarted=$MutationStarted;cleanupComplete=$CleanupComplete;proofKind='AE_EYES_EARS'}
  foreach($k in $Extra.Keys){$o[$k]=$Extra[$k]}
  [IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 16)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
}
function Get-HealthyAe([string]$ResolvedPath) {
  $a=@(); foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){ try{$p.Refresh(); if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$ResolvedPath)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{} }; return @($a)
}
function Resolve-WinApp {
  $c=Get-Command winapp -ErrorAction SilentlyContinue | Select-Object -First 1
  if($c){return [string]$c.Source}
  foreach($p in @((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\winapp.exe'),(Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winapp.exe'))){ if(Test-Path $p -PathType Leaf){return $p} }
  return $null
}
function Invoke-AeJsx([string]$Path) {
  $proc=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',('"'+$Path+'"')) -PassThru
  try { Wait-Process -Id $proc.Id -Timeout 30 -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 2
}

$resolved=(Resolve-Path $AfterFxPath).Path
$targets=Get-HealthyAe $resolved
if($targets.Count-ne1){ Write-Result 'INFRASTRUCTURE_FAILURE' "Expected one healthy AE process, found $($targets.Count)." @{}; exit 2 }
$ae=$targets[0]; $aePid=[int]$ae.Id; $aeHwnd=[IntPtr]$ae.MainWindowHandle
$installLog=Join-Path $ArtifactDir 'install.log'
$winapp=Resolve-WinApp
if(-not $winapp){
  $winget=(Get-Command winget -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if($winget){
    try { & $winget install Microsoft.winappcli --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity 2>&1 | Out-File $installLog -Encoding utf8 } catch { $_ | Out-File $installLog -Append -Encoding utf8 }
    Start-Sleep -Seconds 2
    $winapp=Resolve-WinApp
  }
}
$python=(Get-Command python -ErrorAction Stop | Select-Object -First 1).Source
try { & $python -m pip install --disable-pip-version-check --quiet PyAudioWPatch 2>&1 | Out-File $installLog -Append -Encoding utf8 } catch { $_ | Out-File $installLog -Append -Encoding utf8 }

$tonePath=Join-Path $ArtifactDir 'ae-senses-test-tone.wav'
$capturePath=Join-Path $ArtifactDir 'ae-process-heard.wav'
$audioSummaryPath=Join-Path $ArtifactDir 'audio-summary.json'
$genPy=Join-Path $RepoRoot 'scripts\windows\ae-senses-generate-tone.py'
$capPy=Join-Path $RepoRoot 'scripts\windows\ae-senses-capture-loopback.py'
$anPy=Join-Path $RepoRoot 'scripts\windows\ae-senses-analyze-audio.py'
& $python $genPy $tonePath | Out-File (Join-Path $ArtifactDir 'tone-generation.log') -Encoding utf8
if($LASTEXITCODE-ne0-or-not(Test-Path $tonePath)){ Write-Result 'INFRASTRUCTURE_FAILURE' 'Failed to create deterministic audio test signal.' @{winapp=$winapp}; exit 2 }

$escaped=$tonePath.Replace('\','/').Replace('"','\"')
$setupJsx=Join-Path $ArtifactDir 'setup-ae-senses.jsx'
$cleanupJsx=Join-Path $ArtifactDir 'cleanup-ae-senses.jsx'
$setup=@"
(function(){
  var p=app.project; if(!p){p=app.newProject();}
  for(var i=p.numItems;i>=1;i--){var it=p.item(i); if(it.name==='__GPT_SENSES_TEST__'||it.name==='__GPT_SENSES_TONE__'){try{it.remove();}catch(e){}}}
  var f=new File("$escaped"); if(!f.exists){throw new Error('tone file missing');}
  var io=new ImportOptions(f); var ft=p.importFile(io); ft.name='__GPT_SENSES_TONE__';
  var c=p.items.addComp('__GPT_SENSES_TEST__',640,360,1,4.0,30); c.layers.add(ft); c.time=0; c.openInViewer();
})();
"@
$cleanup=@"
(function(){
  var p=app.project; if(!p){return;}
  for(var i=p.numItems;i>=1;i--){var it=p.item(i); if(it.name==='__GPT_SENSES_TEST__'){try{it.remove();}catch(e){}}}
  for(var j=p.numItems;j>=1;j--){var jt=p.item(j); if(jt.name==='__GPT_SENSES_TONE__'){try{jt.remove();}catch(e){}}}
})();
"@
[IO.File]::WriteAllText($setupJsx,$setup,(New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($cleanupJsx,$cleanup,(New-Object Text.UTF8Encoding($false)))
$MutationStarted=$true
Invoke-AeJsx $setupJsx

$eyesPath=Join-Path $ArtifactDir 'eyes-ae-window.png'
$uiTreePath=Join-Path $ArtifactDir 'eyes-ae-ui-tree.txt'
$winappEyes=$false; $uiTree=$false
if($winapp){
  try { & $winapp ui inspect -a ([string]$aePid) --depth 5 2>&1 | Out-File $uiTreePath -Encoding utf8; $uiTree=(Test-Path $uiTreePath) -and ((Get-Item $uiTreePath).Length -gt 20) } catch { $_ | Out-File $uiTreePath -Encoding utf8 }
  try { & $winapp ui screenshot -a ([string]$aePid) --output $eyesPath --focus 2>&1 | Out-File (Join-Path $ArtifactDir 'eyes-winapp.log') -Encoding utf8; $winappEyes=(Test-Path $eyesPath) -and ((Get-Item $eyesPath).Length -gt 10000) } catch { $_ | Out-File (Join-Path $ArtifactDir 'eyes-winapp.log') -Encoding utf8 }
}

$audioOut=Join-Path $ArtifactDir 'audio-capture.log'
$capArgs=@('"'+$capPy+'"','"'+$capturePath+'"','6.0') -join ' '
$cap=Start-Process -FilePath $python -ArgumentList $capArgs -PassThru -RedirectStandardOutput $audioOut -RedirectStandardError (Join-Path $ArtifactDir 'audio-capture.err.txt') -WindowStyle Hidden
Start-Sleep -Milliseconds 900
[void][EFSensesInput]::SetForegroundWindow($aeHwnd)
Start-Sleep -Milliseconds 350
[EFSensesInput]::Space()
try { Wait-Process -Id $cap.Id -Timeout 15 -ErrorAction Stop } catch { Stop-Process -Id $cap.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
if(-not(Test-Path $capturePath)){ Invoke-AeJsx $cleanupJsx; $CleanupComplete=$true; Write-Result 'INFRASTRUCTURE_FAILURE' 'No loopback WAV was produced while AE previewed the test signal.' @{winapp=$winapp;eyes=$winappEyes;uiTree=$uiTree}; exit 2 }
& $python $anPy $capturePath $audioSummaryPath | Out-File (Join-Path $ArtifactDir 'audio-analysis.log') -Encoding utf8
$audio=$null; if(Test-Path $audioSummaryPath){$audio=Get-Content $audioSummaryPath -Raw|ConvertFrom-Json}

Invoke-AeJsx $cleanupJsx
$CleanupComplete=$true
$after=Get-HealthyAe $resolved
$warmPreserved=($after.Count-eq1-and[int]$after[0].Id-eq$aePid)
$eyesPassed=$winappEyes
$earsPassed=($audio-and[bool]$audio.nonSilent-and[bool]$audio.detected440-and[bool]$audio.detected880)
$extra=@{aePid=$aePid;winappPath=$winapp;eyesScreenshot='eyes-ae-window.png';eyesScreenshotBytes=(if(Test-Path $eyesPath){(Get-Item $eyesPath).Length}else{0});uiTreeExists=$uiTree;eyesPassed=$eyesPassed;audioCapture='ae-process-heard.wav';audioSummary='audio-summary.json';earsPassed=$earsPassed;audio=$audio;warmAePreserved=$warmPreserved}
if(-not$winapp){Write-Result 'PRODUCT_FAILURE' 'WinApp CLI could not be installed/resolved, so structured GPT eyes are incomplete.' $extra; exit 1}
if(-not$eyesPassed){Write-Result 'PRODUCT_FAILURE' 'WinApp CLI was present but did not produce a usable AE screenshot.' $extra; exit 1}
if(-not$earsPassed){Write-Result 'PRODUCT_FAILURE' 'AE audio loopback was captured, but the deterministic 440/880 Hz test signal was not both detected.' $extra; exit 1}
if(-not$warmPreserved){Write-Result 'PRODUCT_FAILURE' 'Sensory proof passed I/O checks but did not preserve the original warm AE process.' $extra; exit 1}
Write-Result 'PASS' 'GPT sensory bridge proved live AE eyes (WinApp screenshot/UI tree) and ears (WASAPI loopback of AE preview) while preserving the warm AE process.' $extra
exit 0
