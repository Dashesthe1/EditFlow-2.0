param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-composite-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
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

$Composite = $Template
$Composite = $Composite.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-composite-p3-p4.ps1')
$Composite = $Composite.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-composite-p3-p4')
$Composite = $Composite.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_COMPOSITE_P4_PROOF')
$Composite = $Composite.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.3 registration')
$Composite = $Composite.Replace('M3 mask P3/P4', 'M3 composite P3/P4')
$Composite = $Composite.Replace('M3 mask/Bezier', 'M3 composite')
$Composite = $Composite.Replace('isolated M3 AE proof', 'isolated M3 composite AE proof')

[System.IO.File]::WriteAllText($TempPath, $Composite, (New-Object System.Text.UTF8Encoding($false)))

# The two proof cleanup modes are intentionally mutually exclusive. A process-level
# mask proof flag inherited from an operator shell or diagnostic session must never
# be allowed to collide with this composite-only runner. Preserve its prior value,
# clear it for the bounded child proof, then restore it after the generated runner
# has completed. The generated runner independently arms/disarms only the composite
# flag before launching its owned After Effects process.
$OriginalMaskProofEnv = $env:EDITFLOW_M3_MASK_P4_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
if ($null -ne $OriginalMaskProofEnv) {
  Write-Host "Composite proof runner temporarily cleared a pre-existing mask proof environment flag."
}

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskProofEnv) {
    $env:EDITFLOW_M3_MASK_P4_PROOF = $OriginalMaskProofEnv
  } else {
    Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue
  }
}
