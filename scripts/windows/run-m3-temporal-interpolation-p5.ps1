param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-interpolation-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

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

$Temporal = $Template
$Temporal = $Temporal.Replace('m3-mask-p5-transfer', 'm3-temporal-interpolation-p5-transfer')
$Temporal = $Temporal.Replace('m3-mask-p5-reopen.jsx', 'm3-temporal-interpolation-p5-reopen.jsx')
$Temporal = $Temporal.Replace('m3-mask-p5-cleanup.jsx', 'm3-temporal-interpolation-p5-cleanup.jsx')
$Temporal = $Temporal.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF')
$Temporal = $Temporal.Replace('m3-mask-p5-cli.js', 'm3-temporal-interpolation-p5-cli.js')
$Temporal = $Temporal.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 temporal-interpolation real-AE P5 save/reopen/reconnect transfer proof')
$Temporal = $Temporal.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: temporal-interpolation P3/P4 source 6b218bf3f6ba0014a6a78fa33769f170dc300fa3 / real-AE run 34166441340.')
$Temporal = $Temporal.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact temporal interpolation readback -> fresh post-reconnect temporal mutation/readback')
$Temporal = $Temporal.Replace('M3 mask P5 CLI', 'M3 temporal-interpolation P5 CLI')
$Temporal = $Temporal.Replace('M3 mask P5', 'M3 temporal-interpolation P5')
$Temporal = $Temporal.Replace('mask_exact_after_reopen_reconnect', 'temporal_exact_after_reopen_reconnect')
$Temporal = $Temporal.Replace('exact mask state transfer across reopen/reconnect', 'exact temporal interpolation state transfer across reopen/reconnect')
$Temporal = $Temporal.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect temporal write/readback authority')
$Temporal = $Temporal.Replace('M3 P5 post-reconnect mask write/readback authority', 'M3 P5 post-reconnect temporal write/readback authority')

[System.IO.File]::WriteAllText($TempPath, $Temporal, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
