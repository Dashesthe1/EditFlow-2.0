param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-parenting-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}

# Connector-authored ref updates do not always emit a GitHub pull_request
# synchronization event. Make the isolated workstation workflow self-sufficient:
# run the exact repository CI gate before installing CEP files or launching AE.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before parenting P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; parenting P3/P4 real-AE proof will not launch." }
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

$Parenting = $Template
$Parenting = $Parenting.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-parenting-p3-p4.ps1')
$Parenting = $Parenting.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-parenting-p3-p4')
$Parenting = $Parenting.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_PARENTING_P4_PROOF')
$Parenting = $Parenting.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.4 registration')
$Parenting = $Parenting.Replace('M3 mask P3/P4', 'M3 parenting P3/P4')
$Parenting = $Parenting.Replace('M3 mask/Bezier', 'M3 parenting')
$Parenting = $Parenting.Replace('isolated M3 AE proof', 'isolated M3 parenting AE proof')
$Parenting = $Parenting.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 parenting P3/P4 acceptance runner is missing')

[System.IO.File]::WriteAllText($TempPath, $Parenting, (New-Object System.Text.UTF8Encoding($false)))

# Proof injection flags are process-global to the owned AE child. Preserve any
# operator shell values, clear unrelated proof modes so host loading cannot become
# mutually ambiguous, then let the generated accepted template arm parenting only.
$OriginalMaskProofEnv = $env:EDITFLOW_M3_MASK_P4_PROOF
$OriginalCompositeProofEnv = $env:EDITFLOW_M3_COMPOSITE_P4_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskProofEnv) { $env:EDITFLOW_M3_MASK_P4_PROOF = $OriginalMaskProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue }
  if ($null -ne $OriginalCompositeProofEnv) { $env:EDITFLOW_M3_COMPOSITE_P4_PROOF = $OriginalCompositeProofEnv }
  else { Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue }
  Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue
}
