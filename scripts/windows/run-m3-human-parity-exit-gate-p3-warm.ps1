param([string]$AfterFxPath="C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",[int]$ProofTimeoutSeconds=35)
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$config=Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$artifactRoot=Join-Path $root "proofs\artifacts\m3-human-parity-exit-gate-p3"
$runId=(Get-Date -Format "yyyyMMdd-HHmmssfff")+"-"+[Guid]::NewGuid().ToString("N").Substring(0,8)
$dir=Join-Path $artifactRoot ("run-"+$runId)
$core=Join-Path $dir "core-result.json";$result=Join-Path $dir "result.json";$ready=Join-Path $dir "broker-ready.json"
$stdout=Join-Path $dir "node.stdout.log";$stderr=Join-Path $dir "node.stderr.log"
$cleanup=Join-Path $root "scripts\windows\cleanup-m3-human-parity-exit-gate.jsx";$verify=Join-Path $root "scripts\windows\verify-blank-unsaved-ae.jsx";$opener=Join-Path $root "scripts\windows\open-editflow2-panel.jsx"
$cleanupEv=Join-Path $env:TEMP "EditFlow2-m3-exit-gate-cleanup.txt";$verifyEv=Join-Path $env:TEMP "EditFlow2-blank-unsaved-proof.txt"
$start=Get-Date;$exit=1;$node=$null
function Ae([string]$script,[string]$ev,[string]$prefix,[int]$seconds=4){if(Test-Path $ev){Remove-Item $ev -Force};[void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r",$script)-PassThru);$d=(Get-Date).AddSeconds($seconds);while((Get-Date)-lt $d){if(Test-Path $ev){$v=(Get-Content $ev -Raw).Trim();if($v.StartsWith($prefix,[StringComparison]::Ordinal)){return $v};throw "AE helper '$script' returned '$v'."};Start-Sleep -Milliseconds 50};throw "AE helper '$script' timed out."}
function PanelConnected(){try{$c=Get-Content $config -Raw|ConvertFrom-Json;$h=@{"X-EditFlow-Token"=[string]$c.token};$s=Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/v1/status"-f[int]$c.port) -Headers $h -TimeoutSec 1;return $s.panelConnected -eq $true}catch{return $false}}
try{
  New-Item -ItemType Directory -Force -Path $dir|Out-Null
  if(-not(Test-Path $AfterFxPath)){throw "AfterFX.exe missing"};if(-not(Test-Path $config)){throw "EditFlow bridge config missing"}
  $running=@(Get-Process -Name AfterFX -ErrorAction SilentlyContinue|Where-Object{$_.Responding});if($running.Count -ne 1){throw "Exit gate requires exactly one responsive warm AE process; found $($running.Count)"}
  $pre=Ae $cleanup $cleanupEv "CLEANED ";$blank=Ae $verify $verifyEv "BLANK_UNSAVED";Write-Host "Exit-gate preflight: $pre; $blank"
  Push-Location $root
  try{if(-not(Test-Path (Join-Path $root "node_modules"))){npm install;if($LASTEXITCODE -ne 0){throw "npm install failed"}};npm run build:test-runtime;if($LASTEXITCODE -ne 0){throw "runtime build failed"}
    $cli=Join-Path $root "scripts\m3-human-parity-exit-gate-p3.mjs";$args=@($cli,"--config",$config,"--result",$core,"--broker-ready",$ready)
    $node=Start-Process -FilePath node -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $d=(Get-Date).AddSeconds(5);while((Get-Date)-lt $d -and -not(Test-Path $ready)){$node.Refresh();if($node.HasExited){break};Start-Sleep -Milliseconds 50};if(-not(Test-Path $ready)){if(Test-Path $stderr){Get-Content $stderr -Tail 80|Write-Host};throw "Exit-gate broker did not become ready"}
    $d=(Get-Date).AddMilliseconds(900);while((Get-Date)-lt $d -and -not(PanelConnected)){Start-Sleep -Milliseconds 50};if(-not(PanelConnected)){[void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r",$opener)-PassThru);Write-Host "Opened EditFlow panel for fresh exit-gate broker"}else{Write-Host "Warm EditFlow panel reconnected automatically"}
    if(-not $node.WaitForExit($ProofTimeoutSeconds*1000)){Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 500;throw "Exit-gate core exceeded $ProofTimeoutSeconds seconds"};if($node.ExitCode -ne 0){if(Test-Path $stderr){Get-Content $stderr -Tail 80|Write-Host};if(Test-Path $core){Get-Content $core -Raw|Write-Host};throw "Exit-gate core failed with $($node.ExitCode)"}
  }finally{Pop-Location}
  $post=Ae $cleanup $cleanupEv "CLEANED ";$blankAfter=Ae $verify $verifyEv "BLANK_UNSAVED";$c=Get-Content $core -Raw|ConvertFrom-Json
  $elapsed=[int]((Get-Date)-$start).TotalMilliseconds;$ok=$c.ok -eq $true -and $c.proofLevels.integratedStructuralReadback -eq $true -and $c.proofLevels.integratedVisualArtifactEmitted -eq $true -and $blankAfter -eq "BLANK_UNSAVED"
  $final=[ordered]@{proofId="M3_HUMAN_PARITY_EXIT_GATE_P3_WARM";status=if($ok){"VISUAL_REVIEW_REQUIRED"}else{"FAILURE"};ok=$ok;elapsedMs=$elapsed;coreElapsedMs=$c.elapsedMs;speedTargetMs=30000;coreSpeedTargetMet=$c.speedTargetMet;visualReviewRequired=$ok;cleanupComplete=$blankAfter -eq "BLANK_UNSAVED";preCleanup=$pre;postCleanup=$post;artifactRun=$runId;core=$c};$final|ConvertTo-Json -Depth 30|Out-File $result -Encoding utf8;Get-Content $result -Raw|Write-Host;$exit=if($ok){0}else{1}
}catch{$message=$_.Exception.Message;if(Test-Path $cleanup){try{$post=Ae $cleanup $cleanupEv "CLEANED ";Write-Host "Failure cleanup: $post"}catch{Write-Host "Failure cleanup also failed: $($_.Exception.Message)"}};Write-Error $message -ErrorAction Continue;$exit=1}finally{if($node){try{$node.Refresh();if(-not $node.HasExited){Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue}}catch{}}}
exit $exit
