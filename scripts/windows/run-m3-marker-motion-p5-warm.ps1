param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 75
)
$ErrorActionPreference="Stop"
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath=Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir=Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p5-transfer"
$ResultPath=Join-Path $ArtifactDir "result.json"
$Preclean=Join-Path $RepoRoot "scripts\windows\cleanup-m3-marker-motion-stale-proof.jsx"
$Arm=Join-Path $RepoRoot "scripts\windows\arm-m3-marker-motion-p5-proof.jsx"
$Disarm=Join-Path $RepoRoot "scripts\windows\disarm-m3-marker-motion-p5-proof.jsx"
$Reopen=Join-Path $RepoRoot "scripts\windows\m3-marker-motion-p5-reopen.jsx"
$Cleanup=Join-Path $RepoRoot "scripts\windows\m3-marker-motion-p5-cleanup.jsx"
$Cli=Join-Path $RepoRoot "scripts\m3-marker-motion-p5.mjs"
$ArmEvidence=Join-Path $env:TEMP "EditFlow2-m3-marker-motion-p5-arm.txt"
$DisarmEvidence=Join-Path $env:TEMP "EditFlow2-m3-marker-motion-p5-disarm.txt"
$PrecleanEvidence=Join-Path $env:TEMP "EditFlow2-m3-marker-motion-stale-cleanup.txt"
$ExitCode=1
function Invoke-AeEvidence([string]$Script,[string]$Evidence,[string]$ExpectedPrefix){
  if(Test-Path $Evidence){Remove-Item $Evidence -Force}
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r",$Script) -PassThru)
  $deadline=(Get-Date).AddSeconds(4)
  while((Get-Date)-lt $deadline){if(Test-Path $Evidence){$v=(Get-Content $Evidence -Raw).Trim();if($v.StartsWith($ExpectedPrefix,[StringComparison]::Ordinal)){return $v};throw "AE helper returned '$v', expected '$ExpectedPrefix'."};Start-Sleep -Milliseconds 50}
  throw "AE helper did not emit '$ExpectedPrefix' evidence."
}
try{
  if($TimeoutSeconds -lt 30){throw "TimeoutSeconds must be at least 30."}
  foreach($p in @($AfterFxPath,$ConfigPath,$Preclean,$Arm,$Disarm,$Reopen,$Cleanup,$Cli)){if(-not(Test-Path $p -PathType Leaf)){throw "Required P5 path missing: $p"}}
  $running=@(Get-Process -Name AfterFX -ErrorAction SilentlyContinue)
  if($running.Count -ne 1){throw "Warm P5 requires exactly one existing After Effects process; found $($running.Count)."}
  $running[0].Refresh();if(-not $running[0].Responding){throw "Existing After Effects process is not responding."}
  New-Item -ItemType Directory -Force -Path $ArtifactDir|Out-Null
  $pre=Invoke-AeEvidence $Preclean $PrecleanEvidence "CLEANED ";Write-Host "Pre-P5 proof-owned cleanup: $pre"
  $armed=Invoke-AeEvidence $Arm $ArmEvidence "ARMED";Write-Host "Marker-motion P5 gate: $armed"
  Push-Location $RepoRoot
  try{
    npm run build:test-runtime
    if($LASTEXITCODE -ne 0){throw "TypeScript runtime build failed."}
    & node $Cli --config $ConfigPath --result $ResultPath --afterfx-path $AfterFxPath --reopen-script $Reopen --cleanup-script $Cleanup --timeout-ms ($TimeoutSeconds*1000)
    $ExitCode=$LASTEXITCODE
  }finally{Pop-Location}
  if(Test-Path $ResultPath){Get-Content $ResultPath -Raw|Write-Host}
}catch{Write-Error ("Marker-motion P5 warm wrapper failed: "+$_.Exception.Message);$ExitCode=1}
finally{
  try{$d=Invoke-AeEvidence $Disarm $DisarmEvidence "DISARMED";Write-Host "Marker-motion P5 gate: $d"}catch{Write-Error ("CRITICAL P5 disarm failure: "+$_.Exception.Message);$ExitCode=1}
}
if($ExitCode -ne 0){exit $ExitCode}
