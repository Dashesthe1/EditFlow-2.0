param(
  [string]$AcceptedArtifactDir = ".accepted-p1-p2",
  [string]$AfterFxPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AcceptedRoot = Join-Path $RepoRoot $AcceptedArtifactDir
$Runner = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-ease-p3-p4-self-hosted.ps1"

if (-not (Test-Path $Runner -PathType Leaf)) {
  throw "Temporal-ease P3/P4 self-hosted runner is missing: $Runner"
}
if (-not (Test-Path $AcceptedRoot -PathType Container)) {
  throw "Downloaded accepted P1/P2 artifact directory is missing: $AcceptedRoot"
}

$Candidates = @(Get-ChildItem -Path $AcceptedRoot -Filter "result.json" -File -Recurse)
if ($Candidates.Count -ne 1) {
  throw "Expected exactly one downloaded P1/P2 result.json; found $($Candidates.Count)."
}
$Accepted = $Candidates[0].FullName
Write-Host "Using accepted P1/P2 dependency from production run 34176061647: $Accepted"

if ($AfterFxPath) {
  & $Runner -AfterFxPath $AfterFxPath -AcceptedP1P2Path $Accepted
} else {
  & $Runner -AcceptedP1P2Path $Accepted
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
