param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-interpolation-p5-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-spatial-graph-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted temporal-interpolation P5 self-hosted runner template is missing: $TemplatePath" }

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'run-m3-temporal-interpolation-p5.ps1',
  'm3-temporal-interpolation-p5-transfer',
  'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF',
  'M3_TEMPORAL_INTERPOLATION_P5_REAL_AE',
  'authenticated protocol 1.7 registration',
  'Temporal P5 generated self-hosted runner',
  'scripts\windows\install-editflow-cep.ps1'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) { throw "Accepted temporal-interpolation P5 self-hosted template drifted; missing guarded token: $Token" }
}

$Spatial = $Template
$Spatial = $Spatial.Replace('run-m3-temporal-interpolation-p5.ps1', 'run-m3-spatial-graph-p5.ps1')
$Spatial = $Spatial.Replace('m3-temporal-interpolation-p5-transfer', 'm3-spatial-graph-p5-transfer')
$Spatial = $Spatial.Replace('EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF', 'EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF')
$Spatial = $Spatial.Replace('M3_TEMPORAL_INTERPOLATION_P5_REAL_AE', 'M3_SPATIAL_GRAPH_P5_REAL_AE')
$Spatial = $Spatial.Replace('run-m3-temporal-interpolation-p5-self-hosted-generated-', 'run-m3-spatial-graph-p5-self-hosted-generated-')
$Spatial = $Spatial.Replace('temporal-interpolation', 'spatial-graph')
$Spatial = $Spatial.Replace('Temporal P5', 'Spatial P5')
$Spatial = $Spatial.Replace('temporal P5', 'spatial P5')
$Spatial = $Spatial.Replace('temporal interpolation', 'spatial Graph Editor')
$Spatial = $Spatial.Replace('protocol 1.7', 'protocol 1.9')

# Protocol 1.9 is transfer-accepted and is now installed by the ordinary EditFlow
# installer. Do not rewrite the generated lifecycle to a preview installer: this P5
# run is intentionally the production-path promotion proof. It must exercise the same
# scripts\windows\install-editflow-cep.ps1 path used by standard EditFlow installs.
if (-not $Spatial.Contains('scripts\windows\install-editflow-cep.ps1')) {
  throw "Generated spatial P5 runner no longer uses the standard EditFlow CEP installer."
}
if ($Spatial.Contains('install-editflow-cep-v19-preview.ps1')) {
  throw "Spatial P5 production-path proof must not route through the former v1.9 preview verifier."
}

[System.IO.File]::WriteAllText($TempPath, $Spatial, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
