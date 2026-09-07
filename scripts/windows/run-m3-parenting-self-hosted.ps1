param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-parenting-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 P1/P2 self-hosted runner template is missing: $TemplatePath"
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

$Parenting = $Template
$Parenting = $Parenting.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-parenting-p1-p2.ps1')
$Parenting = $Parenting.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-parenting-p1-p2')
$Parenting = $Parenting.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 parenting P1/P2 acceptance runner is missing')
$Parenting = $Parenting.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.4 registration')
$Parenting = $Parenting.Replace('isolated M3 AE proof', 'isolated M3 parenting AE proof')

[System.IO.File]::WriteAllText($TempPath, $Parenting, (New-Object System.Text.UTF8Encoding($false)))
try {
  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
