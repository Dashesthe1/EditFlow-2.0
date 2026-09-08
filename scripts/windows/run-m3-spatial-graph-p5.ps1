param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-spatial-graph-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted M3 mask P5 wrapper template is missing: $TemplatePath" }

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
  if (-not $Template.Contains($Token)) { throw "Accepted M3 mask P5 wrapper template drifted; missing guarded token: $Token" }
}

$Spatial = $Template
$Spatial = $Spatial.Replace('m3-mask-p5-transfer', 'm3-spatial-graph-p5-transfer')
$Spatial = $Spatial.Replace('m3-mask-p5-reopen.jsx', 'm3-spatial-graph-p5-reopen.jsx')
$Spatial = $Spatial.Replace('m3-mask-p5-cleanup.jsx', 'm3-spatial-graph-p5-cleanup.jsx')
$Spatial = $Spatial.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF')
$Spatial = $Spatial.Replace('m3-mask-p5-cli.js', 'm3-spatial-graph-p5-cli.js')
$Spatial = $Spatial.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 spatial Graph Editor real-AE P5 save/reopen/reconnect transfer proof')
$Spatial = $Spatial.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: protocol-1.9 P1-P4 acceptance / P3-P4 real-AE run 34184591197.')
$Spatial = $Spatial.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact spatial Graph Editor readback -> native Layer.id continuity -> fresh post-reconnect spatial mutation/readback')
$Spatial = $Spatial.Replace('M3 mask P5 CLI', 'M3 spatial-graph P5 CLI')
$Spatial = $Spatial.Replace('M3 mask P5', 'M3 spatial-graph P5')
$Spatial = $Spatial.Replace('mask_exact_after_reopen_reconnect', 'spatial_exact_after_reopen_reconnect')
$Spatial = $Spatial.Replace('exact mask state transfer across reopen/reconnect', 'exact spatial Graph Editor state transfer across reopen/reconnect')
$Spatial = $Spatial.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect spatial write/readback authority')
$Spatial = $Spatial.Replace('M3 P5 post-reconnect mask write/readback authority', 'M3 P5 post-reconnect spatial write/readback authority')

[System.IO.File]::WriteAllText($TempPath, $Spatial, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
