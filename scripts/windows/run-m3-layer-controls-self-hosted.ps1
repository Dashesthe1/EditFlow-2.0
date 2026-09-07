param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$PanelDiagnosticLog = Join-Path $env:TEMP "EditFlow2-cep-panel-diagnostics.log"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-layer-controls-p1-p2"
$PublishedPanelDiagnosticLog = Join-Path $ArtifactDir "cep-panel-diagnostics.log"

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 P1/P2 self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p1-p2.ps1',
  'proofs\artifacts\m3-mask-p1-p2',
  'The M3 mask P1/P2 acceptance runner is missing',
  'authenticated protocol 1.2 registration',
  '$Arguments = @("-r", $PanelBootstrap)',
  '$BootstrapSucceeded = $false',
  'while ((Get-Date) -lt $BootstrapDeadline) {'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-layer-controls-p1-p2.ps1')
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-layer-controls-p1-p2')
$LayerControls = $LayerControls.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 layer-controls P1/P2 acceptance runner is missing')
$LayerControls = $LayerControls.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.6 registration')
$LayerControls = $LayerControls.Replace('isolated M3 AE proof', 'isolated M3 layer-controls AE proof')

# The installed CEP panel is AutoVisible. On AE 25.6.6 the panel can become active
# during the command-delivery hold, before the proof broker starts. Sending the same
# Window-menu command at that point toggles the already-open panel closed; run
# 34152371601 proved this with DIAGNOSTICS_SCRIPT_STARTED followed by
# PANEL_BEFORE_UNLOAD immediately after EXECUTE_COMMAND_SENT. For this tranche only,
# derive a fresh panel-active signal from the diagnostic file that this wrapper
# deletes before launch. Skip the menu toggle when the newest panel lifecycle event
# is a start rather than an unload; the panel's existing reconnect loop will register
# as soon as the acceptance broker binds.
$OldPanelArguments = '  $Arguments = @("-r", $PanelBootstrap)'
$NewPanelArguments = @'
  $LayerControlsPanelDiagnosticLog = Join-Path $env:TEMP "EditFlow2-cep-panel-diagnostics.log"
  $PanelAlreadyLoaded = $false
  if (Test-Path $LayerControlsPanelDiagnosticLog -PathType Leaf) {
    $LayerControlsPanelDiagnosticText = Get-Content $LayerControlsPanelDiagnosticLog -Raw
    $PanelStartedAt = $LayerControlsPanelDiagnosticText.LastIndexOf("DIAGNOSTICS_SCRIPT_STARTED")
    $PanelUnloadedAt = $LayerControlsPanelDiagnosticText.LastIndexOf("PANEL_BEFORE_UNLOAD")
    $PanelAlreadyLoaded = $PanelStartedAt -ge 0 -and $PanelStartedAt -gt $PanelUnloadedAt
  }
  if ($PanelAlreadyLoaded) {
    Write-StartupDiagnostic "PANEL_BOOTSTRAP_SKIPPED_ALREADY_LOADED" "freshDiagnosticLifecycle=started"
    Write-Host "Phase 2 panel bootstrap skipped because the CEP panel is already loaded and its reconnect loop is active."
  } else {
    $Arguments = @("-r", $PanelBootstrap)
'@
$LayerControls = $LayerControls.Replace($OldPanelArguments, $NewPanelArguments.TrimEnd("`r", "`n"))
$LayerControls = $LayerControls.Replace(
  '  Write-AeTopLevelWindowSnapshot "PANEL_BOOTSTRAP_DISPATCH"',
  "  Write-AeTopLevelWindowSnapshot `"PANEL_BOOTSTRAP_DISPATCH`"`r`n  }"
)
$LayerControls = $LayerControls.Replace('  $BootstrapSucceeded = $false', '  $BootstrapSucceeded = $PanelAlreadyLoaded')
$LayerControls = $LayerControls.Replace('  while ((Get-Date) -lt $BootstrapDeadline) {', '  while (-not $BootstrapSucceeded -and (Get-Date) -lt $BootstrapDeadline) {')
$LayerControls = $LayerControls.Replace(
  'After Effects executed the fixed panel bootstrap and proved the EditFlow panel open command was sent. The M3 harness will wait for authenticated protocol 1.6 registration.',
  'After Effects has an active EditFlow CEP panel (already loaded or opened by the fixed bootstrap). The M3 harness will wait for authenticated protocol 1.6 registration.'
)

[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))

$PreviousProofMode = $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF
$PreviousProofPrefix = $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX
$env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF = "1"
$env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX = "M3_LAYER_CONTROLS_P12_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()

if (Test-Path $PanelDiagnosticLog -PathType Leaf) { Remove-Item $PanelDiagnosticLog -Force }
if (Test-Path $PublishedPanelDiagnosticLog -PathType Leaf) { Remove-Item $PublishedPanelDiagnosticLog -Force }

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  try {
    if (Test-Path $PanelDiagnosticLog -PathType Leaf) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      Copy-Item $PanelDiagnosticLog $PublishedPanelDiagnosticLog -Force
      Write-Host "EditFlow CEP panel diagnostics:"
      Get-Content $PanelDiagnosticLog -Raw | Write-Host
    } else {
      Write-Warning "No CEP panel diagnostic log was produced; the panel client may not have loaded."
    }
  } finally {
    if ($null -eq $PreviousProofMode) { Remove-Item Env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF -ErrorAction SilentlyContinue }
    else { $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF = $PreviousProofMode }
    if ($null -eq $PreviousProofPrefix) { Remove-Item Env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX -ErrorAction SilentlyContinue }
    else { $env:EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX = $PreviousProofPrefix }
    Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  }
}
