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
$UsingPreexistingAfterFx = $false

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

if (-not (Test-Path $ProofScript -PathType Leaf)) { throw "M2 P4/P5 proof script not found: $ProofScript" }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 1) {
  $Ids = ($ExistingAfterFx | ForEach-Object { $_.Id }) -join ","
  throw "Refusing disposable P4/P5 proof because multiple pre-existing After Effects sessions make the target ambiguous (PID(s): $Ids). No AE writes were attempted."
}

if ($ExistingAfterFx.Count -eq 1) {
  $UsingPreexistingAfterFx = $true
  $ExistingPath = $null
  try { $ExistingPath = $ExistingAfterFx[0].Path } catch { $ExistingPath = $null }
  if (-not $ExistingPath -or -not (Test-Path $ExistingPath -PathType Leaf)) {
    throw "Refusing disposable P4/P5 proof because the executable path of pre-existing AE PID $($ExistingAfterFx[0].Id) could not be resolved safely."
  }
  $AfterFx = (Resolve-Path $ExistingPath).Path

  if ($AfterFxPath) {
    $ExplicitResolved = Resolve-AfterFx $AfterFxPath
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($ExplicitResolved, $AfterFx)) {
      throw "Refusing disposable P4/P5 proof because explicit AfterFX path '$ExplicitResolved' does not match pre-existing AE PID $($ExistingAfterFx[0].Id) executable '$AfterFx'."
    }
  }

  Write-Warning ("Pre-existing After Effects PID " + $ExistingAfterFx[0].Id + " detected at '" + $AfterFx + "'. The JSX blank/unsaved/zero-item gate is authoritative; the runner will not close this process.")
} else {
  $AfterFx = Resolve-AfterFx $AfterFxPath
  Write-Host "No pre-existing After Effects session detected; the runner will own and later close the AE process it launches."
}

Write-Warning "DESTRUCTIVE DISPOSABLE-PROJECT GATE: the AE proof REFUSES before mutations unless the target project has zero items and has never been saved."
Write-Host "The proof saves only its disposable project under proofs/artifacts, closes/reopens it, and leaves AE on a new blank project."
Write-Host "After Effects: $AfterFx"
Write-Host "Proof script:  $ProofScript"

try {
  $Arguments = @("-r", ('"' + $ProofScript + '"'))
  $LaunchedAfterFx = Start-Process -FilePath $AfterFx -ArgumentList $Arguments -PassThru
  if ($UsingPreexistingAfterFx) {
    Write-Host ("Delivered the proof request through the exact executable of pre-existing AE PID " + $ExistingAfterFx[0].Id + ".")
  } else {
    $OwnedAfterFx = $LaunchedAfterFx
    Write-Host ("Started runner-owned After Effects proof process PID " + $OwnedAfterFx.Id + ".")
  }

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-Path $ResultPath -PathType Leaf)) {
    if ($null -ne $OwnedAfterFx) {
      $OwnedAfterFx.Refresh()
      if ($OwnedAfterFx.HasExited) {
        throw "The runner-owned After Effects proof process exited before producing P4/P5 result.json."
      }
    }
    if ((Get-Date) -ge $Deadline) {
      throw "Timed out waiting for P4/P5 result.json. The proof either did not reach AE or AE did not complete the disposable acceptance script."
    }
    Start-Sleep -Milliseconds 500
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("M2 P4/P5 status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($Result.projectArtifact) { Write-Host ("Disposable project artifact: " + $Result.projectArtifact) }

  if ($Result.status -eq "REFUSED") {
    throw "P4/P5 proof refused safely because the target AE project was not blank, unsaved, and zero-item. No proof mutations were performed."
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
  } elseif ($UsingPreexistingAfterFx) {
    Write-Host ("Leaving pre-existing After Effects PID " + $ExistingAfterFx[0].Id + " running; the runner does not own it.")
  }
}

exit 0
