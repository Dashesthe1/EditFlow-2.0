param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-interpolation-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-interpolation-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 temporal-interpolation P3/P4 self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-temporal-interpolation-p3-p4.ps1',
  'proofs\artifacts\m3-temporal-interpolation-p3-p4',
  'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF',
  'authenticated protocol 1.7 registration',
  'npm run check'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted temporal P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

# Reuse the current successful protocol-1.7 cold-start, diagnostics, CEP install,
# and clean-quit machinery. Only the acceptance wrapper, artifact namespace,
# proof environment flag, generated names, and P5 labels are changed.
$P5 = $Template
$P5 = $P5.Replace('scripts\windows\run-m3-temporal-interpolation-p3-p4.ps1', 'scripts\windows\run-m3-temporal-interpolation-p5.ps1')
$P5 = $P5.Replace('proofs\artifacts\m3-temporal-interpolation-p3-p4', 'proofs\artifacts\m3-temporal-interpolation-p5-transfer')
$P5 = $P5.Replace('EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF', 'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF')
$P5 = $P5.Replace('m3-temporal-interpolation-p3-p4-self-hosted-generated-', 'm3-temporal-interpolation-p5-inner-generated-')
$P5 = $P5.Replace('M3 temporal-interpolation P3/P4', 'M3 temporal-interpolation P5')
$P5 = $P5.Replace('temporal-interpolation P3/P4', 'temporal-interpolation P5')
$P5 = $P5.Replace('Temporal P3/P4', 'Temporal P5')
$P5 = $P5.Replace('P3/P4', 'P5')
$P5 = $P5.Replace('P4_PROOF_INJECTION_ARMED', 'P5_TRANSFER_PROOF_ARMED')
$P5 = $P5.Replace('P4_PROOF_INJECTION_DISARMED', 'P5_TRANSFER_PROOF_DISARMED')
$P5 = $P5.Replace('arm only protocol-1.7 temporal-interpolation P4', 'arm only protocol-1.7 temporal-interpolation P5 transfer')
$P5 = $P5.Replace('protocol-1.7 temporal-interpolation P4', 'protocol-1.7 temporal-interpolation P5 transfer')

[System.IO.File]::WriteAllText($TempPath, $P5, (New-Object System.Text.UTF8Encoding($false)))

# Preserve the operator shell while ensuring unrelated proof modes cannot leak
# into the isolated AE child. The transformed proven runner owns the exact
# EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF flag for this bounded transfer run.
$NearbyP5EnvNames = @(
  "EDITFLOW_M3_MASK_P5_PROOF",
  "EDITFLOW_M3_COMPOSITE_P5_PROOF",
  "EDITFLOW_M3_PARENTING_P5_PROOF",
  "EDITFLOW_M3_NULL_RIG_P5_PROOF",
  "EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF"
)
$OriginalNearbyP5Env = @{}
foreach ($Name in $NearbyP5EnvNames) {
  $OriginalNearbyP5Env[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
  Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
}

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  foreach ($Name in $NearbyP5EnvNames) {
    $OriginalValue = $OriginalNearbyP5Env[$Name]
    if ($null -ne $OriginalValue) { [Environment]::SetEnvironmentVariable($Name, [string]$OriginalValue, "Process") }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
  }
}
