param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-null-rig-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 P1/P2 self-hosted runner template is missing: $TemplatePath"
}

# Ref updates authored through the GitHub connector do not always emit a PR
# synchronization event. Refuse to install CEP or launch After Effects until the
# exact checked-out null-rig candidate passes the full repository gate.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before null-rig P1/P2 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; null-rig P1/P2 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p1-p2.ps1',
  'proofs\artifacts\m3-mask-p1-p2',
  'The M3 mask P1/P2 acceptance runner is missing',
  'authenticated protocol 1.2 registration'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$NullRig = $Template
$NullRig = $NullRig.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-null-rig-p1-p2.ps1')
$NullRig = $NullRig.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-null-rig-p1-p2')
$NullRig = $NullRig.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 null-rig P1/P2 acceptance runner is missing')
$NullRig = $NullRig.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.5 registration')
$NullRig = $NullRig.Replace('isolated M3 AE proof', 'isolated M3 null-rig AE proof')
$NullRig = $NullRig.Replace('M3 mask/Bezier', 'M3 true-null rig')
$NullRig = $NullRig.Replace('M3 mask P1/P2', 'M3 null-rig P1/P2')

[System.IO.File]::WriteAllText($TempPath, $NullRig, (New-Object System.Text.UTF8Encoding($false)))

# Nearby proof flags are process-global to the runner-owned AE child. Preserve the
# operator shell and clear them for this structural proof so no failure-injection or
# transfer-only host path can accidentally alter protocol 1.5 P1/P2 evidence.
$ProofEnvNames = @(
  'EDITFLOW_M3_MASK_P4_PROOF',
  'EDITFLOW_M3_COMPOSITE_P4_PROOF',
  'EDITFLOW_M3_PARENTING_P4_PROOF',
  'EDITFLOW_M3_MASK_P5_PROOF',
  'EDITFLOW_M3_COMPOSITE_P5_PROOF',
  'EDITFLOW_M3_PARENTING_P5_PROOF'
)
$OriginalProofEnv = @{}
foreach ($Name in $ProofEnvNames) {
  $OriginalProofEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
}

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  foreach ($Name in $ProofEnvNames) {
    $Value = $OriginalProofEnv[$Name]
    if ($null -ne $Value) { [Environment]::SetEnvironmentVariable($Name, $Value, 'Process') }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
  }
}
