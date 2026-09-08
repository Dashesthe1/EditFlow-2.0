param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-marker-motion-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-marker-motion-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$AcceptedP1P2Path = Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p1-p2\result.json"

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted marker-motion P1/P2 self-hosted runner template is missing: $TemplatePath"
}
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) {
  throw "Accepted marker-motion P1/P2 artifact is missing. Run the marker-motion P1/P2 self-hosted proof first in this workspace: $AcceptedP1P2Path"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-marker-motion-p1-p2.ps1',
  'proofs\artifacts\m3-marker-motion-p1-p2',
  'Protocol 2.0 is intentionally not advertised',
  '$PreviewInstallBlock',
  'Marker-motion proof mode: isolated authenticated protocol 2.0 preview'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted marker-motion self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$P3P4 = $Template
$P3P4 = $P3P4.Replace('scripts\windows\run-m3-marker-motion-p1-p2.ps1', 'scripts\windows\run-m3-marker-motion-p3-p4.ps1')
$P3P4 = $P3P4.Replace('proofs\artifacts\m3-marker-motion-p1-p2', 'proofs\artifacts\m3-marker-motion-p3-p4')
$P3P4 = $P3P4.Replace('marker-motion P1/P2', 'marker-motion P3/P4')
$P3P4 = $P3P4.Replace('Marker-motion proof mode: isolated authenticated protocol 2.0 preview', 'Marker-motion P3/P4 proof mode: isolated authenticated protocol 2.0 preview with proof-gated rollback injection')
[System.IO.File]::WriteAllText($TempPath, $P3P4, (New-Object System.Text.UTF8Encoding($false)))

$OriginalProofEnv = $env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF
$env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF = "1"
Write-Host "Armed EDITFLOW_M3_MARKER_MOTION_P4_PROOF only for the runner-owned isolated AE process."

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalProofEnv) {
    $env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF = $OriginalProofEnv
  } else {
    Remove-Item Env:EDITFLOW_M3_MARKER_MOTION_P4_PROOF -ErrorAction SilentlyContinue
  }
}
