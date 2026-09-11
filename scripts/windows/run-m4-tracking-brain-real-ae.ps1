param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [int]$Frames = 12
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TrackingRunner = Join-Path $PSScriptRoot "run-m4-tracking-real-ae.ps1"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m4-point-tracking-real-ae"
$TrackingResult = Join-Path $ArtifactDir "result.json"
$SemanticResult = Join-Path $ArtifactDir "semantic-decision.json"

if (-not (Test-Path $TrackingRunner -PathType Leaf)) { throw "M4 tracking runner is missing: $TrackingRunner" }
$Before = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Responding -and $_.MainWindowHandle -ne 0 })
if ($Before.Count -ne 1) { throw "M4 tracking-to-brain proof requires exactly one responsive After Effects project process; found $($Before.Count)." }
$InitialPid = [int]$Before[0].Id

& $TrackingRunner -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds -Frames $Frames
if (-not (Test-Path $TrackingResult -PathType Leaf)) { throw "Authenticated M4 tracking result is missing: $TrackingResult" }
$Tracking = Get-Content $TrackingResult -Raw | ConvertFrom-Json
if (-not $Tracking.ok -or $Tracking.classification -ne "PASS") {
  Get-Content $TrackingResult -Raw | Write-Host
  throw "Authenticated M4 tracking proof failed before semantic/brain evaluation."
}

$SemanticCli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m4-tracking-semantic-decision-cli.js"
if (-not (Test-Path $SemanticCli -PathType Leaf)) { throw "Compiled M4 semantic-decision CLI is missing: $SemanticCli" }
Remove-Item $SemanticResult -Force -ErrorAction SilentlyContinue
& node $SemanticCli --tracking-result $TrackingResult --result $SemanticResult
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $SemanticResult -PathType Leaf) { Get-Content $SemanticResult -Raw | Write-Host }
  throw "M4 semantic/Editor Brain decision-only proof failed."
}
if (-not (Test-Path $SemanticResult -PathType Leaf)) { throw "M4 semantic/Editor Brain result is missing: $SemanticResult" }
$Semantic = Get-Content $SemanticResult -Raw | ConvertFrom-Json
if (-not $Semantic.ok -or $Semantic.classification -ne "PASS_DECISION_ONLY_FAIL_CLOSED") {
  Get-Content $SemanticResult -Raw | Write-Host
  throw "M4 semantic/Editor Brain result did not satisfy the fail-closed decision gate."
}

$After = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Responding -and $_.MainWindowHandle -ne 0 })
if ($After.Count -ne 1 -or [int]$After[0].Id -ne $InitialPid) { throw "After Effects PID changed during the tracking-to-brain REUSE_AE proof." }

Write-Host "M4 tracking -> Trusted Editor State -> Editor Brain decision-only proof: PASS"
Write-Host ("After Effects PID preserved: " + $InitialPid)
Write-Host ("Tracking artifact: " + $TrackingResult)
Write-Host ("Semantic/brain artifact: " + $SemanticResult)
