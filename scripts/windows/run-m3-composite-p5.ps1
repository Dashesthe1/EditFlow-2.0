param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-composite-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

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
  'mask_exact_after_reopen_reconnect'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 mask P5 wrapper template drifted; missing guarded token: $Token"
  }
}

$Composite = $Template
$Composite = $Composite.Replace('m3-mask-p5-transfer', 'm3-composite-p5-transfer')
$Composite = $Composite.Replace('m3-mask-p5-reopen.jsx', 'm3-composite-p5-reopen.jsx')
$Composite = $Composite.Replace('m3-mask-p5-cleanup.jsx', 'm3-composite-p5-cleanup.jsx')
$Composite = $Composite.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_COMPOSITE_P5_PROOF')
$Composite = $Composite.Replace('m3-mask-p5-cli.js', 'm3-composite-p5-cli.js')
$Composite = $Composite.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 composite real-AE P5 save/reopen/reconnect transfer proof')
$Composite = $Composite.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: main merge e629e2b6c463c0467a20e145445976f9a88a4a24 / P3-P4 real-AE run 34079590956.')
$Composite = $Composite.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact composite readback -> clear/reassign matte + fresh blend mutation/readback')
$Composite = $Composite.Replace('M3 mask P5 CLI', 'M3 composite P5 CLI')
$Composite = $Composite.Replace('M3 mask P5', 'M3 composite P5')
$Composite = $Composite.Replace('mask_exact_after_reopen_reconnect', 'composite_exact_after_reopen_reconnect')
$Composite = $Composite.Replace('exact mask state transfer across reopen/reconnect', 'exact composite state transfer across reopen/reconnect')
$Composite = $Composite.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect composite clear/reassign/blend/readback authority')

[System.IO.File]::WriteAllText($TempPath, $Composite, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
