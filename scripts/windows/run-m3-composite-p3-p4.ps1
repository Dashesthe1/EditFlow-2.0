param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-composite-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 wrapper template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'proofs\artifacts\m3-mask-p3-p4',
  'm3-mask-p3-p4-cli.js',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'M3 mask P3/P4'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 wrapper template drifted; missing guarded token: $Token"
  }
}

$Composite = $Template
$Composite = $Composite.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-composite-p3-p4')
$Composite = $Composite.Replace('m3-mask-p3-p4-cli.js', 'm3-composite-p3-p4-cli.js')
$Composite = $Composite.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_COMPOSITE_P4_PROOF')
$Composite = $Composite.Replace('M3 mask/Bezier real-AE P3 visual-artifact + P4 rollback proof', 'M3 composite real-AE P3 visual-artifact + P4 rollback proof')
$Composite = $Composite.Replace('M3 mask P3/P4', 'M3 composite P3/P4')
$Composite = $Composite.Replace('M3 mask P3/P4 CLI', 'M3 composite P3/P4 CLI')
$Composite = $Composite.Replace('deterministic mask-driven compositing render', 'deterministic LUMA-matte + ADD-blend compositing render')
$Composite = $Composite.Replace('temporary imported bitmaps plus one temporary comp/layers/mask', 'temporary imported bitmaps plus one temporary comp/layers')

[System.IO.File]::WriteAllText($TempPath, $Composite, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
