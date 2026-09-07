param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 P1/P2 self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p1-p2.ps1',
  'proofs\artifacts\m3-mask-p1-p2',
  'The M3 mask P1/P2 acceptance runner is missing',
  'authenticated protocol 1.2 registration'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-layer-controls-p1-p2.ps1')
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-layer-controls-p1-p2')
$LayerControls = $LayerControls.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 layer-controls P1/P2 acceptance runner is missing')
$LayerControls = $LayerControls.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.6 registration')
$LayerControls = $LayerControls.Replace('isolated M3 AE proof', 'isolated M3 layer-controls AE proof')

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))

$PreviousProofMode = $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF
$PreviousProofPrefix = $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX
$env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF = "1"
$env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX = "M3_LAYER_CONTROLS_P12_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($null -eq $PreviousProofMode) { Remove-Item Env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF -ErrorAction SilentlyContinue }
  else { $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF = $PreviousProofMode }
  if ($null -eq $PreviousProofPrefix) { Remove-Item Env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX -ErrorAction SilentlyContinue }
  else { $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX = $PreviousProofPrefix }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
