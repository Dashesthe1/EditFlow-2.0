param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-motion-render-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-motion-render-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$PreviousProofFlag = $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted protocol 1.10 P1/P2 self-hosted template is missing: $TemplatePath" }
$Template = [System.IO.File]::ReadAllText($TemplatePath)
foreach ($Token in @(
  'run-m3-motion-render-p1-p2.ps1',
  'proofs\artifacts\m3-motion-render-p1-p2',
  'install-editflow-cep-v110-preview.ps1',
  '$MaxPanelRegistrationAttempts = 2',
  'CEP_PANEL_REGISTRATION_TIMEOUT'
)) {
  if (-not $Template.Contains($Token)) { throw "Motion-render P1/P2 self-hosted template drifted; missing guarded token: $Token" }
}

$P34 = $Template.Replace('run-m3-motion-render-p1-p2.ps1', 'run-m3-motion-render-p3-p4.ps1')
$P34 = $P34.Replace('proofs\artifacts\m3-motion-render-p1-p2', 'proofs\artifacts\m3-motion-render-p3-p4')
$P34 = $P34.Replace('motion-render P1/P2', 'motion-render P3/P4')
$P34 = $P34.Replace('Motion-render proof mode:', 'Motion-render P3/P4 proof mode:')
if (-not $P34.Contains('run-m3-motion-render-p3-p4.ps1')) { throw "Generated P3/P4 self-hosted runner did not select the P3/P4 acceptance wrapper." }
if (-not $P34.Contains('install-editflow-cep-v110-preview.ps1')) { throw "Generated P3/P4 self-hosted runner lost the isolated protocol 1.10 preview installer." }
[System.IO.File]::WriteAllText($TempPath, $P34, (New-Object System.Text.UTF8Encoding($false)))

try {
  # The proof-only host injection reads its process environment from After Effects.
  # Arm the flag before the inherited lifecycle launches its owned AE process.
  $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF = "1"
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  if ($null -eq $PreviousProofFlag) { Remove-Item Env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF -ErrorAction SilentlyContinue }
  else { $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF = $PreviousProofFlag }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
