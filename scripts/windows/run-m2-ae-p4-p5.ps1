param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProofScript = Join-Path $RepoRoot "proofs\ae\m2-disposable-p4-p5-proof.jsx"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-disposable-p4-p5"
$ResultPath = Join-Path $ArtifactDir "result.json"
$OwnedAfterFx = $null

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

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  $Ids = ($ExistingAfterFx | ForEach-Object { $_.Id }) -join ","
  throw "Refusing disposable P4/P5 proof because a pre-existing After Effects session is running (PID(s): $Ids). The self-hosted proof never attaches to or closes an unowned AE session."
}

Write-Warning "DESTRUCTIVE DISPOSABLE-PROJECT GATE: this runner launches its own fresh AE process, and the AE script still REFUSES unless that project has zero items and has never been saved."
Write-Host "The proof saves only its disposable project under proofs/artifacts, closes/reopens it, leaves a blank project, then this runner closes only the AE process it launched."
Write-Host "After Effects: $AfterFx"
Write-Host "Proof script:  $ProofScript"

try {
  $Arguments = @("-r", ('"' + $ProofScript + '"'))
  $OwnedAfterFx = Start-Process -FilePath $AfterFx -ArgumentList $Arguments -PassThru
  Write-Host ("Started isolated After Effects proof process PID " + $OwnedAfterFx.Id + ".")

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-Path $ResultPath -PathType Leaf)) {
    if ($OwnedAfterFx.HasExited) {
      throw "The isolated After Effects proof process exited before producing P4/P5 result.json."
    }
    if ((Get-Date) -ge $Deadline) {
      throw "Timed out waiting for P4/P5 result.json from the isolated After Effects proof process."
    }
    Start-Sleep -Milliseconds 500
    $OwnedAfterFx.Refresh()
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("M2 P4/P5 status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($Result.projectArtifact) { Write-Host ("Disposable project artifact: " + $Result.projectArtifact) }

  if ($Result.status -eq "REFUSED") {
    throw "P4/P5 proof refused safely because the runner-owned AE project was not blank and unsaved."
  }
  if (-not $Result.ok) {
    if ($Result.error) { Write-Error $Result.error }
    throw "M2 P4/P5 real-AE proof failed. Inspect the uploaded/result artifacts before retrying."
  }
} finally {
  if ($null -ne $OwnedAfterFx) {
    try {
      $OwnedAfterFx.Refresh()
      if (-not $OwnedAfterFx.HasExited) {
        Write-Host ("Stopping only runner-owned After Effects proof process PID " + $OwnedAfterFx.Id + "...")
        Stop-Process -Id $OwnedAfterFx.Id -Force -ErrorAction Stop
        Wait-Process -Id $OwnedAfterFx.Id -Timeout 15 -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Warning ("Unable to stop runner-owned After Effects proof process cleanly: " + $_.Exception.Message)
    }
  }
}

exit 0
