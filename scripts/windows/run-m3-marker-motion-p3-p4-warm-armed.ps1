param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArmScript = Join-Path $RepoRoot "scripts\windows\arm-m3-marker-motion-p4-proof.jsx"
$DisarmScript = Join-Path $RepoRoot "scripts\windows\disarm-m3-marker-motion-p4-proof.jsx"
$InnerWrapper = Join-Path $RepoRoot "scripts\windows\run-m3-marker-motion-p3-p4-warm.ps1"
$ArmEvidence = Join-Path $env:TEMP "EditFlow2-m3-marker-motion-p4-arm.txt"
$DisarmEvidence = Join-Path $env:TEMP "EditFlow2-m3-marker-motion-p4-disarm.txt"
$ExitCode = 1

function Invoke-AeScriptAndWaitEvidence {
  param(
    [string]$ScriptPath,
    [string]$EvidencePath,
    [string]$Expected
  )
  if (Test-Path $EvidencePath -PathType Leaf) { Remove-Item -LiteralPath $EvidencePath -Force }
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $ScriptPath) -PassThru)
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $EvidencePath -PathType Leaf) {
      $value = (Get-Content $EvidencePath -Raw).Trim()
      if ($value -eq $Expected) { return }
      throw "AE proof-gate helper returned '$value' instead of '$Expected'."
    }
    Start-Sleep -Milliseconds 50
  }
  throw "AE proof-gate helper did not produce '$Expected' evidence within three seconds."
}

try {
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe not found: $AfterFxPath" }
  if (-not (Test-Path $ArmScript -PathType Leaf)) { throw "P4 arm helper missing: $ArmScript" }
  if (-not (Test-Path $DisarmScript -PathType Leaf)) { throw "P4 disarm helper missing: $DisarmScript" }
  if (-not (Test-Path $InnerWrapper -PathType Leaf)) { throw "Inner marker-motion wrapper missing: $InnerWrapper" }

  Invoke-AeScriptAndWaitEvidence -ScriptPath $ArmScript -EvidencePath $ArmEvidence -Expected "ARMED"
  Write-Host "M3 marker-motion P4 proof gate armed inside the existing AE process."

  & $InnerWrapper -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  $ExitCode = $LASTEXITCODE
} catch {
  Write-Error ("Marker-motion armed wrapper failed: " + $_.Exception.Message)
  $ExitCode = 1
} finally {
  try {
    Invoke-AeScriptAndWaitEvidence -ScriptPath $DisarmScript -EvidencePath $DisarmEvidence -Expected "DISARMED"
    Write-Host "M3 marker-motion P4 proof gate disarmed inside the existing AE process."
  } catch {
    Write-Error ("CRITICAL: failed to disarm M3 marker-motion P4 proof gate: " + $_.Exception.Message)
    $ExitCode = 1
  }
}

if ($ExitCode -ne 0) { exit $ExitCode }
