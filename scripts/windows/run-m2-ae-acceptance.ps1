param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProofScript = Join-Path $RepoRoot "proofs\ae\m2-real-host-proof.jsx"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$ResultPath = Join-Path $ArtifactDir "result.json"

function Resolve-AfterFx {
  param([string]$ExplicitPath)
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found at explicit path: $ExplicitPath" }
    return (Resolve-Path $ExplicitPath).Path
  }

  $AdobeRoot = Join-Path $env:ProgramFiles "Adobe"
  if (-not (Test-Path $AdobeRoot -PathType Container)) { throw "Adobe Program Files directory not found: $AdobeRoot" }
  $Candidates = Get-ChildItem $AdobeRoot -Directory -Filter "Adobe After Effects *" |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "Support Files\AfterFX.exe" } |
    Where-Object { Test-Path $_ -PathType Leaf }
  $Resolved = $Candidates | Select-Object -First 1
  if (-not $Resolved) { throw "Unable to locate AfterFX.exe. Pass -AfterFxPath explicitly." }
  return $Resolved
}

$AfterFx = Resolve-AfterFx $AfterFxPath
if (-not (Test-Path $ProofScript -PathType Leaf)) { throw "M2 proof script not found: $ProofScript" }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }

$Running = Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue
if (-not $Running) {
  throw "Adobe After Effects is not running. Open After Effects with a project you are willing to use for a bounded temporary proof, then rerun this command. The proof does not save or replace the project."
}

Write-Host "EditFlow 2.0 M2 real-AE proof"
Write-Host "After Effects: $AfterFx"
Write-Host "Proof script:  $ProofScript"

$Arguments = @("-r", ('"' + $ProofScript + '"'))
Start-Process -FilePath $AfterFx -ArgumentList $Arguments | Out-Null

$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $ResultPath -PathType Leaf)) {
  if ((Get-Date) -ge $Deadline) {
    throw "Timed out waiting for M2 result.json. In After Effects, enable Edit > Preferences > Scripting & Expressions > Allow Scripts To Write Files And Access Network, then rerun."
  }
  Start-Sleep -Milliseconds 500
}

$Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
Write-Host ("M2 proof status: " + $Result.status)
Write-Host ("Result artifact: " + $ResultPath)
if ($Result.renderArtifact) { Write-Host ("Render artifact: " + $Result.renderArtifact) }

if (-not $Result.ok) {
  if ($Result.error) { Write-Error $Result.error }
  throw "M2 bounded real-AE proof did not pass all implemented checks."
}

if (-not $Result.proofLevels.P4_failure_injection_rollback -or -not $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
  Write-Warning "Bounded host proof passed, but M2 remains open: P4 failure-injection rollback and P5 save/reopen/reconnect are intentionally not claimed by this script."
}

exit 0
