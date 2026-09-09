param([Parameter(Mandatory=$true)][string]$AfterFxPath,[int]$TimeoutSeconds=180)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactDir=$env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
$MutationStarted=$false;$CleanupComplete=$false;$CleanupJsx=$null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EFSensesKeys {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
 public static void AudioPreview(){ keybd_event(0x6E,0,0,UIntPtr.Zero); keybd_event(0x6E,0,0x0002,UIntPtr.Zero); }
}
"@
function Result($c,$m,$e){$o=[ordered]@{classification=$c;ok=($c-eq'PASS');message=$m;mutationStarted=$MutationStarted;cleanupComplete=$CleanupComplete;proofKind='AE_EYES_EARS_V2'};foreach($k in $e.Keys){$o[$k]=$e[$k]};[IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 16)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function HealthyAe($path){$a=@();foreach($p in @(Get-Process AfterFX -ErrorAction SilentlyContinue)){try{$p.Refresh();if([StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $p.Path).Path,$path)-and$p.Responding-and$p.MainWindowHandle-ne0){$a+=$p}}catch{}};return @($a)}
function RunJsx($p){$x=Start-Process -FilePath $AfterFxPath -ArgumentList @('-r',$p) -PassThru;try{Wait-Process -Id $x.Id -Timeout 20 -ErrorAction SilentlyContinue}catch{};Start-Sleep -Seconds 2}
try{
 $resolved=(Resolve-Path $AfterFxPath).Path;$targets=HealthyAe $resolved;if($targets.Count-ne1){throw "Expected one healthy AE process, found $($targets.Count)."};$ae=$targets[0];$pid0=[int]$ae.Id;$hwnd=[IntPtr]$ae.MainWindowHandle
 $winapp=(Get-Command winapp -ErrorAction Stop|Select-Object -First 1).Source;$python=(Get-Command python -ErrorAction Stop|Select-Object -First 1).Source
 try{& $python -c "import pyaudiowpatch"}catch{& $python -m pip install --disable-pip-version-check --quiet PyAudioWPatch}
 $tone=Join-Path $ArtifactDir 'test-tone.wav';$heard=Join-Path $ArtifactDir 'heard-from-ae.wav';$summary=Join-Path $ArtifactDir 'audio-summary.json'
 & $python (Join-Path $RepoRoot 'scripts\windows\ae-senses-generate-tone.py') $tone|Out-File (Join-Path $ArtifactDir 'tone.log') -Encoding utf8
 if($LASTEXITCODE-ne0-or-not(Test-Path $tone)){throw 'Tone generation failed.'}
 $escaped=$tone.Replace('\','/').Replace('"','\"');$setup=Join-Path $ArtifactDir 'setup.jsx';$CleanupJsx=Join-Path $ArtifactDir 'cleanup.jsx'
 [IO.File]::WriteAllText($setup,"(function(){var p=app.project;if(!p){p=app.newProject();}for(var i=p.numItems;i>=1;i--){var it=p.item(i);if(it.name==='__GPT_SENSES_TEST__'||it.name==='__GPT_SENSES_TONE__'){try{it.remove();}catch(e){}}}var f=new File('"+$escaped+"');var io=new ImportOptions(f);var ft=p.importFile(io);ft.name='__GPT_SENSES_TONE__';var c=p.items.addComp('__GPT_SENSES_TEST__',640,360,1,4,30);c.layers.add(ft);c.time=0;c.openInViewer();})();")
 [IO.File]::WriteAllText($CleanupJsx,"(function(){var p=app.project;if(!p){return;}for(var i=p.numItems;i>=1;i--){if(p.item(i).name==='__GPT_SENSES_TEST__'){try{p.item(i).remove();}catch(e){}}}for(var j=p.numItems;j>=1;j--){if(p.item(j).name==='__GPT_SENSES_TONE__'){try{p.item(j).remove();}catch(e){}}}})();")
 $MutationStarted=$true;RunJsx $setup
 $eyes=Join-Path $ArtifactDir 'eyes.png';$tree=Join-Path $ArtifactDir 'ui-tree.txt'
 & $winapp ui inspect -a ([string]$pid0) --depth 7 2>&1|Out-File $tree -Encoding utf8
 & $winapp ui screenshot -a ([string]$pid0) --output $eyes --focus 2>&1|Out-File (Join-Path $ArtifactDir 'eyes.log') -Encoding utf8
 $eyesOk=(Test-Path $eyes)-and((Get-Item $eyes).Length-gt10000);$treeOk=(Test-Path $tree)-and((Get-Item $tree).Length-gt100)
 if(-not$eyesOk){throw 'WinApp did not produce a usable AE screenshot.'}
 $capOut=Join-Path $ArtifactDir 'capture.stdout.txt';$capErr=Join-Path $ArtifactDir 'capture.stderr.txt';$capPy=Join-Path $RepoRoot 'scripts\windows\ae-senses-capture-loopback.py'
 $args=@('"'+$capPy+'"','"'+$heard+'"','5.5')-join' ';$cap=Start-Process -FilePath $python -ArgumentList $args -PassThru -RedirectStandardOutput $capOut -RedirectStandardError $capErr -WindowStyle Hidden
 Start-Sleep -Milliseconds 700;[void][EFSensesKeys]::SetForegroundWindow($hwnd);Start-Sleep -Milliseconds 300;[EFSensesKeys]::AudioPreview()
 try{Wait-Process -Id $cap.Id -Timeout 12 -ErrorAction Stop}catch{Stop-Process -Id $cap.Id -Force -ErrorAction SilentlyContinue;throw 'WASAPI capture did not finish in time.'}
 if(-not(Test-Path $heard)-or(Get-Item $heard).Length-le44){throw 'WASAPI produced no audio frames.'}
 & $python (Join-Path $RepoRoot 'scripts\windows\ae-senses-analyze-audio.py') $heard $summary|Out-File (Join-Path $ArtifactDir 'analysis.log') -Encoding utf8
 if($LASTEXITCODE-ne0-or-not(Test-Path $summary)){throw 'Audio verification helper failed.'};$audio=Get-Content $summary -Raw|ConvertFrom-Json
 RunJsx $CleanupJsx;$CleanupComplete=$true
 $after=HealthyAe $resolved;$warm=($after.Count-eq1-and[int]$after[0].Id-eq$pid0);$ears=([bool]$audio.nonSilent-and[bool]$audio.detected440-and[bool]$audio.detected880)
 $extra=@{aePid=$pid0;winapp=$winapp;eyesPassed=$eyesOk;uiTreePassed=$treeOk;eyesScreenshot='eyes.png';uiTree='ui-tree.txt';earsPassed=$ears;audioCapture='heard-from-ae.wav';audioSummary='audio-summary.json';audio=$audio;warmAePreserved=$warm}
 if(-not$ears){Result 'PRODUCT_FAILURE' 'Visual sensing passed, but AE loopback audio did not contain both expected test tones.' $extra;exit 1};if(-not$warm){Result 'PRODUCT_FAILURE' 'Eyes and ears passed but the original warm AE process was not preserved.' $extra;exit 1}
 Result 'PASS' 'Live AE eyes and ears are both operational: WinApp exposed the AE window/UI tree and WASAPI captured the audio AE previewed.' $extra;exit 0
}catch{
 try{if($MutationStarted-and$CleanupJsx-and(Test-Path $CleanupJsx)){RunJsx $CleanupJsx;$CleanupComplete=$true}}catch{}
 Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{exception=$_.Exception.ToString()};exit 2
}
