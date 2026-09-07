param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  'M3 mask P3/P4'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-layer-controls-p3-p4.ps1')
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-layer-controls-p3-p4')
$LayerControls = $LayerControls.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF')
$LayerControls = $LayerControls.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.6 registration')
$LayerControls = $LayerControls.Replace('M3 mask P3/P4', 'M3 layer-controls P3/P4')
$LayerControls = $LayerControls.Replace('M3 mask/Bezier', 'M3 layer-controls')
$LayerControls = $LayerControls.Replace('isolated M3 AE proof', 'isolated M3 layer-controls AE proof')

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))

# Keep proof hooks mutually isolated. The generated runner owns only the
# layer-controls flag; stale flags from other M3 proof sessions are cleared for
# this child run and restored afterwards.
$OriginalMaskProofEnv = $env:EDITFLOW_M3_MASK_P4_PROOF
$OriginalCompositeProofEnv = $env:EDITFLOW_M3_COMPOSITE_P4_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskProofEnv) {
    $env:EDITFLOW_M3_MASK_P4_PROOF = $OriginalMaskProofEnv
  } else {
    Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
  }
  if ($null -ne $OriginalCompositeProofEnv) {
    $env:EDITFLOW_M3_COMPOSITE_P4_PROOF = $OriginalCompositeProofEnv
  } else {
    Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue
  }
}