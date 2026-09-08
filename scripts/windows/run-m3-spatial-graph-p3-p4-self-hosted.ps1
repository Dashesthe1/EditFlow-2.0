param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [Parameter(Mandatory = $true)]
  [string]$AcceptedP1P2Path,
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-ease-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-spatial-graph-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted temporal-ease P3/P4 self-hosted lineage is missing: $TemplatePath" }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted spatial P1/P2 result artifact is missing: $AcceptedP1P2Path" }
$AcceptedP1P2Path = (Resolve-Path $AcceptedP1P2Path).Path

$Source = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'run-m3-temporal-ease-p3-p4.ps1',
  'm3-temporal-ease-p3-p4',
  'EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF',
  'authenticated protocol 1.8 registration',
  '$Ease = $Template'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Source.Contains($Token)) { throw "Accepted temporal-ease P3/P4 lineage drifted; missing guarded token: $Token" }
}

$Spatial = $Source
$Spatial = $Spatial.Replace('run-m3-temporal-ease-p3-p4.ps1', 'run-m3-spatial-graph-p3-p4.ps1')
$Spatial = $Spatial.Replace('m3-temporal-ease-p3-p4', 'm3-spatial-graph-p3-p4')
$Spatial = $Spatial.Replace('M3 temporal-ease P3/P4', 'M3 spatial-graph P3/P4')
$Spatial = $Spatial.Replace('M3 temporal-ease', 'M3 spatial-graph')
$Spatial = $Spatial.Replace('temporal-ease P3/P4', 'spatial-graph P3/P4')
$Spatial = $Spatial.Replace('Temporal-ease P3/P4', 'Spatial-graph P3/P4')
$Spatial = $Spatial.Replace('temporal-ease P1/P2', 'spatial P1/P2')
$Spatial = $Spatial.Replace('EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF', 'EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF')
$Spatial = $Spatial.Replace('authenticated protocol 1.8 registration', 'authenticated protocol 1.9 preview registration')

# The accepted temporal lineage installs the normal accepted CEP build. For this
# unpromoted 1.9 proof only, patch the generated isolated launcher so the exact
# proof process uses the preview installer; repository/default installation stays 1.8.
$Needle = '$Ease = $Template'
$Replacement = '$Ease = $Template' + [Environment]::NewLine + '$Ease = $Ease.Replace(''scripts\windows\install-editflow-cep.ps1'', ''scripts\windows\install-editflow-cep-v19-preview.ps1'')'
$Spatial = $Spatial.Replace($Needle, $Replacement)

[System.IO.File]::WriteAllText($TempPath, $Spatial, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -AcceptedP1P2Path $AcceptedP1P2Path -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
