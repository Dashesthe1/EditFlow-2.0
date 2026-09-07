param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-null-rig-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}

# The isolated workstation must prove the exact checked-out source is repository-green
# before installing CEP files or launching AE.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before null-rig P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; null-rig P3/P4 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

$NullRig = $Template
$NullRig = $NullRig.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-null-rig-p3-p4.ps1')
$NullRig = $NullRig.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-null-rig-p3-p4')
$NullRig = $NullRig.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_NULL_RIG_P4_PROOF')
$NullRig = $NullRig.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.5 registration')
$NullRig = $NullRig.Replace('M3 mask P3/P4', 'M3 null-rig P3/P4')
$NullRig = $NullRig.Replace('M3 mask/Bezier', 'M3 null-rig controller')
$NullRig = $NullRig.Replace('isolated M3 AE proof', 'isolated M3 null-rig AE proof')
$NullRig = $NullRig.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 null-rig P3/P4 acceptance runner is missing')

[System.IO.File]::WriteAllText($TempPath, $NullRig, (New-Object System.Text.UTF8Encoding($false)))

# Only the null-rig P4 hook may be armed in the runner-owned AE child. Preserve the
# operator shell, clear every adjacent proof mode, then restore them after execution.
$OriginalMaskProofEnv = $env:EDITFLOW_M3_MASK_P4_PROOF
$OriginalCompositeProofEnv = $env:EDITFLOW_M3_COMPOSITE_P4_PROOF
$OriginalParentingProofEnv = $env:EDITFLOW_M3_PARENTING_P4_PROOF
$OriginalNullRigProofEnv = $env:EDITFLOW_M3_NULL_RIG_P4_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ErrorAction SilentlyContinue

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskProofEnv) { $env:EDITFLOW_M3_MASK_P4_PROOF = $OriginalMaskProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalCompositeProofEnv) { $env:EDITFLOW_M3_COMPOSITE_P4_PROOF = $OriginalCompositeProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalParentingProofEnv) { $env:EDITFLOW_M3_PARENTING_P4_PROOF = $OriginalParentingProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalNullRigProofEnv) { $env:EDITFLOW_M3_NULL_RIG_P4_PROOF = $OriginalNullRigProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ErrorAction SilentlyContinue }
}
