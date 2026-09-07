param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  'if ($BootstrapText -match "EXECUTE_COMMAND_SENT") {',
  'After Effects did not produce fixed-bootstrap EXECUTE_COMMAND_SENT evidence within $BootstrapEvidenceTimeoutSeconds seconds.',
  'After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.2 registration.'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-layer-controls-p3-p4.ps1')
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-layer-controls-p3-p4')
$LayerControls = $LayerControls.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF')
$LayerControls = $LayerControls.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.6 registration')
$LayerControls = $LayerControls.Replace('M3 mask P3/P4', 'M3 layer-controls P3/P4')
$LayerControls = $LayerControls.Replace('M3 mask/Bezier', 'M3 layer-controls')
$LayerControls = $LayerControls.Replace('isolated M3 AE proof', 'isolated M3 layer-controls AE proof')

# The accepted shared template requires EXECUTE_COMMAND_SENT because it was built
# around a proof that always needed to open the panel. Protocol 1.6 can arrive at
# the same safe state with the CEP panel already loaded at cold start. The fixed
# bootstrap script records PANEL_ALREADY_LOADED only after verifying its installed
# manifest script-path marker, so accept either bootstrap-success signal here. The
# downstream acceptance wrapper still requires authenticated protocol 1.6 broker
# registration before any typed layer-controls proof command can run.
$LayerControls = $LayerControls.Replace(
  'if ($BootstrapText -match "EXECUTE_COMMAND_SENT") {',
  'if ($BootstrapText -match "EXECUTE_COMMAND_SENT" -or $BootstrapText -match "PANEL_ALREADY_LOADED") {'
)
$LayerControls = $LayerControls.Replace(
  'After Effects did not produce fixed-bootstrap EXECUTE_COMMAND_SENT evidence within $BootstrapEvidenceTimeoutSeconds seconds.',
  'After Effects did not produce fixed-bootstrap EXECUTE_COMMAND_SENT or verified PANEL_ALREADY_LOADED evidence within $BootstrapEvidenceTimeoutSeconds seconds.'
)
$LayerControls = $LayerControls.Replace(
  'After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.6 registration.',
  'After Effects produced verified EditFlow panel bootstrap evidence (command sent or panel already loaded). The M3 layer-controls harness will still require authenticated protocol 1.6 registration before proof execution.'
)

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))

# Proof hooks are process-level test gates. Clear unrelated M3 P4 gates while the
# generated runner owns its isolated AE process, then restore the caller shell.
$OtherProofFlags = @(
  'EDITFLOW_M3_MASK_P4_PROOF',
  'EDITFLOW_M3_COMPOSITE_P4_PROOF',
  'EDITFLOW_M3_PARENTING_P4_PROOF',
  'EDITFLOW_M3_NULL_RIG_P4_PROOF'
)
$SavedProofFlags = @{}
foreach ($Flag in $OtherProofFlags) {
  $SavedProofFlags[$Flag] = [Environment]::GetEnvironmentVariable($Flag, 'Process')
  Remove-Item ("Env:" + $Flag) -ErrorAction SilentlyContinue
}

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  foreach ($Flag in $OtherProofFlags) {
    $Previous = $SavedProofFlags[$Flag]
    if ($null -ne $Previous) {
      [Environment]::SetEnvironmentVariable($Flag, [string]$Previous, 'Process')
    } else {
      Remove-Item ("Env:" + $Flag) -ErrorAction SilentlyContinue
    }
  }
}
