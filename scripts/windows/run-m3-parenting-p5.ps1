param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-parenting-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

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

$Parenting = $Template
$Parenting = $Parenting.Replace('m3-mask-p5-transfer', 'm3-parenting-p5-transfer')
$Parenting = $Parenting.Replace('m3-mask-p5-reopen.jsx', 'm3-parenting-p5-reopen.jsx')
$Parenting = $Parenting.Replace('m3-mask-p5-cleanup.jsx', 'm3-parenting-p5-cleanup.jsx')
$Parenting = $Parenting.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_PARENTING_P5_PROOF')
$Parenting = $Parenting.Replace('m3-mask-p5-cli.js', 'm3-parenting-p5-cli.js')
$Parenting = $Parenting.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 parenting real-AE P5 save/reopen/reconnect transfer proof')
$Parenting = $Parenting.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: main merge a2d4acf47668f47d18fce86ccce60ed52674cab2 / P3-P4 real-AE run 34084958343.')
$Parenting = $Parenting.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact parenting readback -> clear/re-parent + fresh readback')
$Parenting = $Parenting.Replace('M3 mask P5 CLI', 'M3 parenting P5 CLI')
$Parenting = $Parenting.Replace('M3 mask P5', 'M3 parenting P5')
$Parenting = $Parenting.Replace('mask_exact_after_reopen_reconnect', 'parenting_exact_after_reopen_reconnect')
$Parenting = $Parenting.Replace('exact mask state transfer across reopen/reconnect', 'exact parenting state transfer across reopen/reconnect')
$Parenting = $Parenting.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect parenting clear/re-parent/readback authority')

[System.IO.File]::WriteAllText($TempPath, $Parenting, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
