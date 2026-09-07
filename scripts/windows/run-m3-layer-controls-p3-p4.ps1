param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 wrapper template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'proofs\artifacts\m3-mask-p3-p4',
  'm3-mask-p3-p4-cli.js',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'M3 mask P3/P4',
  '$Result.visualReviewSpec.render'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 wrapper template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-layer-controls-p3-p4')
$LayerControls = $LayerControls.Replace('m3-mask-p3-p4-cli.js', 'm3-layer-controls-p3-p4-cli.js')
$LayerControls = $LayerControls.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF')
$LayerControls = $LayerControls.Replace('M3 mask/Bezier real-AE P3 visual-artifact + P4 rollback proof', 'M3 layer-controls real-AE P3 visual-artifact + P4 rollback proof')
$LayerControls = $LayerControls.Replace('M3 mask P3/P4', 'M3 layer-controls P3/P4')
$LayerControls = $LayerControls.Replace('M3 mask P3/P4 CLI', 'M3 layer-controls P3/P4 CLI')
$LayerControls = $LayerControls.Replace('deterministic mask-driven compositing render', 'deterministic layer Video-switch and stacking-order renders')
$LayerControls = $LayerControls.Replace('temporary imported bitmaps plus one temporary comp/layers/mask; after the terminal post-rollback render, a proof-gated host wrapper verifies that exact unsaved fixture before discarding it and creating a fresh blank project, which the harness must re-observe at the original structural fingerprint', 'two temporary imported bitmaps plus one temporary comp and two layers; cleanup uses bounded transaction Undo and must restore the original structural fingerprint')
$LayerControls = $LayerControls.Replace('$Result.visualReviewSpec.render', '$Result.visualReviewSpec.switchDisabledRender')
$LayerControls = $LayerControls.Replace('P3 render: ', 'P3 switch-disabled render: ')

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}