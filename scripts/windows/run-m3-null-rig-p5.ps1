param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-null-rig-p5-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

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

$NullRig = $Template
$NullRig = $NullRig.Replace('m3-mask-p5-transfer', 'm3-null-rig-p5-transfer')
$NullRig = $NullRig.Replace('m3-mask-p5-reopen.jsx', 'm3-null-rig-p5-reopen.jsx')
$NullRig = $NullRig.Replace('m3-mask-p5-cleanup.jsx', 'm3-null-rig-p5-cleanup.jsx')
$NullRig = $NullRig.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_NULL_RIG_P5_PROOF')
$NullRig = $NullRig.Replace('m3-mask-p5-cli.js', 'm3-null-rig-p5-cli.js')
$NullRig = $NullRig.Replace('M3 mask/Bezier real-AE P5 save/reopen/reconnect transfer proof', 'M3 managed null-rig real-AE P5 save/reopen/reconnect transfer proof')
$NullRig = $NullRig.Replace('Accepted baseline: main merge 2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb / P3-P4 real-AE run 34073726432.', 'Accepted baseline: null-rig parent merge 09cb3e88eaba3dfbb365f3341e8a847b0f147dc1 / P3-P4 real-AE run 34140788458.')
$NullRig = $NullRig.Replace('exact mask readback -> fresh post-reconnect mutation/readback', 'exact true-null topology readback -> fresh detach/remove/create/readback/remove with owned-source reclamation')
$NullRig = $NullRig.Replace('M3 mask P5 CLI', 'M3 null-rig P5 CLI')
$NullRig = $NullRig.Replace('M3 mask P5', 'M3 null-rig P5')
$NullRig = $NullRig.Replace('mask_exact_after_reopen_reconnect', 'null_rig_exact_after_reopen_reconnect')
$NullRig = $NullRig.Replace('exact mask state transfer across reopen/reconnect', 'exact managed true-null identity/topology transfer across reopen/reconnect')
$NullRig = $NullRig.Replace('fresh post-reconnect mask write/readback authority', 'fresh post-reconnect null create/remove/readback authority with exact owned-source reclamation')

[System.IO.File]::WriteAllText($TempPath, $NullRig, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
