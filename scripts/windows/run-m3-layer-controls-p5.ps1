param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P5 wrapper template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'm3-mask-p5-transfer',
  'm3-mask-p5-reopen.jsx',
  'm3-mask-p5-cleanup.jsx',
  'EDITFLOW_M3_MASK_P5_PROOF',
  'm3-mask-p5-cli.js',
  'mask_exact_after_reopen_reconnect',
  'post_reconnect_mutation_readback'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 mask P5 wrapper template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('m3-mask-p5-transfer', 'm3-layer-controls-p5-transfer')
$LayerControls = $LayerControls.Replace('m3-mask-p5-reopen.jsx', 'm3-layer-controls-p5-reopen.jsx')
$LayerControls = $LayerControls.Replace('m3-mask-p5-cleanup.jsx', 'm3-layer-controls-p5-cleanup.jsx')
$LayerControls = $LayerControls.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF')
$LayerControls = $LayerControls.Replace('m3-mask-p5-cli.js', 'm3-layer-controls-p5-cli.js')
$LayerControls = $LayerControls.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 layer-controls real-AE P5 save/reopen/reconnect transfer proof')
$LayerControls = $LayerControls.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: layer-controls P3/P4 merge 7dc3558b932995dba078030089226b894cf95d85 / real-AE run 34159635705.')
$LayerControls = $LayerControls.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact all-switch/order readback plus native Layer.id continuity -> fresh post-reconnect switch/order mutation/readback')
$LayerControls = $LayerControls.Replace('M3 mask P5 CLI', 'M3 layer-controls P5 CLI')
$LayerControls = $LayerControls.Replace('M3 mask P5', 'M3 layer-controls P5')
$LayerControls = $LayerControls.Replace('mask_exact_after_reopen_reconnect', 'layer_controls_exact_after_reopen_reconnect')
$LayerControls = $LayerControls.Replace('exact mask state transfer across reopen/reconnect', 'exact layer-switch/order state and native layer identity transfer across reopen/reconnect')
$LayerControls = $LayerControls.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect layer-switch/order write/readback authority')
$LayerControls = $LayerControls.Replace('M3 P5 post-reconnect mask write/readback authority', 'M3 P5 post-reconnect layer-switch/order write/readback authority')

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
