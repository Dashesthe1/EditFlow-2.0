param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-interpolation-p5-self-hosted.ps1"
$BaseLifecyclePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-spatial-graph-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted temporal-interpolation P5 self-hosted runner template is missing: $TemplatePath" }
if (-not (Test-Path $BaseLifecyclePath -PathType Leaf)) { throw "Accepted low-level M3 self-hosted lifecycle is missing: $BaseLifecyclePath" }

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'run-m3-temporal-interpolation-p5.ps1',
  'm3-temporal-interpolation-p5-transfer',
  'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF',
  'M3_TEMPORAL_INTERPOLATION_P5_REAL_AE',
  'authenticated protocol 1.7 registration',
  'Temporal P5 generated self-hosted runner'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) { throw "Accepted temporal-interpolation P5 self-hosted template drifted; missing guarded token: $Token" }
}

# The temporal P5 generator inherits its actual AE launch/install lifecycle from the
# accepted mask P3/P4 self-hosted runner. Guard the production installer at that
# source-of-truth level rather than incorrectly requiring the outer generator to
# duplicate the installer literal.
$BaseLifecycle = [System.IO.File]::ReadAllText($BaseLifecyclePath)
if (-not $BaseLifecycle.Contains('$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"')) {
  throw "Accepted low-level M3 self-hosted lifecycle no longer points to the standard EditFlow CEP installer."
}
if ($BaseLifecycle.Contains('install-editflow-cep-v19-preview.ps1')) {
  throw "Spatial P5 production-path proof refuses a low-level lifecycle that routes through the former v1.9 preview verifier."
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
# installer inherited from the accepted low-level lifecycle. Do not inject any
# preview-installer replacement into the generated script.
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
