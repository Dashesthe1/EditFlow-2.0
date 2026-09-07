param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-null-rig-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P5 self-hosted runner template is missing: $TemplatePath"
}

# Connector-authored ref updates do not always emit a pull_request synchronization
# event. Refuse to install CEP or launch AE unless the exact checked-out P5 candidate
# passes the repository gate first.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before null-rig P5 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; null-rig P5 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p5.ps1',
  'proofs\artifacts\m3-mask-p5-transfer',
  'EDITFLOW_M3_MASK_P5_PROOF',
  'isolated M3 P5 AE proof'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 mask P5 self-hosted template drifted; missing guarded token: $Token"
  }
}

$NullRig = $Template
$NullRig = $NullRig.Replace('scripts\windows\run-m3-mask-p5.ps1', 'scripts\windows\run-m3-null-rig-p5.ps1')
$NullRig = $NullRig.Replace('proofs\artifacts\m3-mask-p5-transfer', 'proofs\artifacts\m3-null-rig-p5-transfer')
$NullRig = $NullRig.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_NULL_RIG_P5_PROOF')
$NullRig = $NullRig.Replace('M3 mask P5', 'M3 null-rig P5')
$NullRig = $NullRig.Replace('M3 P5 self-hosted proof', 'M3 null-rig P5 self-hosted proof')
$NullRig = $NullRig.Replace('isolated M3 P5 AE proof', 'isolated M3 null-rig P5 AE proof')
$NullRig = $NullRig.Replace('M3 P5 attempt', 'M3 null-rig P5 attempt')
$NullRig = $NullRig.Replace('M3 P5 authenticated transfer harness', 'M3 null-rig P5 authenticated transfer harness')

[System.IO.File]::WriteAllText($TempPath, $NullRig, (New-Object System.Text.UTF8Encoding($false)))

# Proof flags are inherited by the runner-owned AE child. Preserve operator-shell
# values, clear every nearby proof mode, and let the generated accepted template
# arm only the managed null-rig P5 transfer mode.
$OriginalMaskP5Env = $env:EDITFLOW_M3_MASK_P5_PROOF
$OriginalCompositeP5Env = $env:EDITFLOW_M3_COMPOSITE_P5_PROOF
$OriginalParentingP5Env = $env:EDITFLOW_M3_PARENTING_P5_PROOF
$OriginalNullRigP4Env = $env:EDITFLOW_M3_NULL_RIG_P4_PROOF
$OriginalParentingP4Env = $env:EDITFLOW_M3_PARENTING_P4_PROOF
$OriginalMaskP4Env = $env:EDITFLOW_M3_MASK_P4_PROOF
$OriginalCompositeP4Env = $env:EDITFLOW_M3_COMPOSITE_P4_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_COMPOSITE_P5_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_PARENTING_P5_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_NULL_RIG_P5_PROOF -ErrorAction SilentlyContinue

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskP5Env) { $env:EDITFLOW_M3_MASK_P5_PROOF = $OriginalMaskP5Env }
  else { Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalCompositeP5Env) { $env:EDITFLOW_M3_COMPOSITE_P5_PROOF = $OriginalCompositeP5Env }
  else { Remove-Item Env:EDITFLOW_M3_COMPOSITE_P5_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalParentingP5Env) { $env:EDITFLOW_M3_PARENTING_P5_PROOF = $OriginalParentingP5Env }
  else { Remove-Item Env:EDITFLOW_M3_PARENTING_P5_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalNullRigP4Env) { $env:EDITFLOW_M3_NULL_RIG_P4_PROOF = $OriginalNullRigP4Env }
  else { Remove-Item Env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalParentingP4Env) { $env:EDITFLOW_M3_PARENTING_P4_PROOF = $OriginalParentingP4Env }
  else { Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalMaskP4Env) { $env:EDITFLOW_M3_MASK_P4_PROOF = $OriginalMaskP4Env }
  else { Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalCompositeP4Env) { $env:EDITFLOW_M3_COMPOSITE_P4_PROOF = $OriginalCompositeP4Env }
  else { Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue }
  Remove-Item Env:EDITFLOW_M3_NULL_RIG_P5_PROOF -ErrorAction SilentlyContinue
}
