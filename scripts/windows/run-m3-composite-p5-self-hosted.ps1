param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-composite-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P5 self-hosted runner template is missing: $TemplatePath"
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

$Composite = $Template
$Composite = $Composite.Replace('scripts\windows\run-m3-mask-p5.ps1', 'scripts\windows\run-m3-composite-p5.ps1')
$Composite = $Composite.Replace('proofs\artifacts\m3-mask-p5-transfer', 'proofs\artifacts\m3-composite-p5-transfer')
$Composite = $Composite.Replace('EDITFLOW_M3_MASK_P5_PROOF', 'EDITFLOW_M3_COMPOSITE_P5_PROOF')
$Composite = $Composite.Replace('M3 mask P5', 'M3 composite P5')
$Composite = $Composite.Replace('M3 P5 self-hosted proof', 'M3 composite P5 self-hosted proof')
$Composite = $Composite.Replace('isolated M3 P5 AE proof', 'isolated M3 composite P5 AE proof')
$Composite = $Composite.Replace('M3 P5 attempt', 'M3 composite P5 attempt')
$Composite = $Composite.Replace('M3 P5 authenticated transfer harness', 'M3 composite P5 authenticated transfer harness')

[System.IO.File]::WriteAllText($TempPath, $Composite, (New-Object System.Text.UTF8Encoding($false)))

# Keep mask/composite P5 proof scripts mutually isolated even if an operator shell
# happens to carry the accepted mask proof flag. Preserve and restore it around the
# bounded composite runner rather than allowing both fixed cleanup scripts to become
# eligible in the same After Effects process environment.
$OriginalMaskP5Env = $env:EDITFLOW_M3_MASK_P5_PROOF
Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue
if ($null -ne $OriginalMaskP5Env) {
  Write-Host "Composite P5 runner temporarily cleared a pre-existing mask P5 proof environment flag."
}

try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $OriginalMaskP5Env) {
    $env:EDITFLOW_M3_MASK_P5_PROOF = $OriginalMaskP5Env
  } else {
    Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue
  }
}
