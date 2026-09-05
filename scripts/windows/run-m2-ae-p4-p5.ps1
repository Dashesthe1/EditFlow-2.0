param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProofScript = Join-Path $RepoRoot "proofs\ae\m2-disposable-p4-p5-proof.jsx"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-disposable-p4-p5"
$ResultPath = Join-Path $ArtifactDir "result.json"

function Resolve-AfterFx {
  param([string]$ExplicitPath)
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found at explicit path: $ExplicitPath" }
    return (Resolve-Path $ExplicitPath).Path
  }
  $AdobeRoot = Join-Path $env:ProgramFiles "Adobe"
  if (-not (Test-Path $AdobeRoot -PathType Container)) { throw "Adobe Program Files directory not found: $AdobeRoot" }
  $Resolved = Get-ChildItem $AdobeRoot -Directory -Filter "Adobe After Effects *" |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "Support Files\AfterFX.exe" } |
    Where-Object { Test-Path $_ -PathType Leaf } |
    Select-Object -First 1
  if (-not $Resolved) { throw "Unable to locate AfterFX.exe. Pass -AfterFxPath explicitly." }
  return $Resolved
}

$AfterFx = Resolve-AfterFx $AfterFxPath
if (-not (Test-Path $ProofScript -PathType Leaf)) { throw "M2 P4/P5 proof script not found: $ProofScript" }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }

$Running = Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue
if (-not $Running) {
  throw "Adobe After Effects is not running. Start AE first, create a new blank UNSAVED project, and rerun."
}

Write-Warning "DESTRUCTIVE DISPOSABLE-PROJECT GATE: the AE script will REFUSE unless the current project has zero items and has never been saved."
Write-Host "It will save that blank proof project under proofs/artifacts, close/reopen it, then leave AE with a new blank project."
Write-Host "After Effects: $AfterFx"
Write-Host "Proof script:  $ProofScript"

$Arguments = @("-r", ('"' + $ProofScript + '"'))
Start-Process -FilePath $AfterFx -ArgumentList $Arguments | Out-Null

$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $ResultPath -PathType Leaf)) {
  if ((Get-Date) -ge $Deadline) {
    throw "Timed out waiting for P4/P5 result.json. Confirm scripting file/network access is enabled in After Effects."
  }
  Start-Sleep -Milliseconds 500
}

$Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
Write-Host ("M2 P4/P5 status: " + $Result.status)
Write-Host ("Result artifact: " + $ResultPath)
if ($Result.projectArtifact) { Write-Host ("Disposable project artifact: " + $Result.projectArtifact) }

if ($Result.status -eq "REFUSED") {
  throw "P4/P5 proof refused safely because the current AE project was not blank and unsaved. Create File > New Project, do not save it, and rerun."
}
if (-not $Result.ok) {
  if ($Result.error) { Write-Error $Result.error }
  throw "M2 P4/P5 real-AE proof failed. Inspect the uploaded/result artifacts before retrying."
}

exit 0
