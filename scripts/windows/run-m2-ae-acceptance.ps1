param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProofScript = Join-Path $RepoRoot "proofs\ae\m2-real-host-proof.jsx"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$ResultPath = Join-Path $ArtifactDir "result.json"

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. Open the exact After Effects version/project you are willing to use for the bounded temporary proof, then rerun. The proof does not save or replace the project."
  }

  $RunningPaths = @()
  foreach ($Process in $Running) {
    $ProcessPath = $null
    try { $ProcessPath = $Process.Path } catch { $ProcessPath = $null }
    if ($ProcessPath -and (Test-Path $ProcessPath -PathType Leaf)) {
      $ResolvedPath = (Resolve-Path $ProcessPath).Path
      if ($RunningPaths -notcontains $ResolvedPath) { $RunningPaths += $ResolvedPath }
    }
  }

  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found at explicit path: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
    if ($RunningPaths -notcontains $ResolvedExplicit) {
      throw "The explicit AfterFxPath is not an already running After Effects executable: $ResolvedExplicit. Open that exact AE version first, or omit -AfterFxPath when only one AE version is running."
    }
    return $ResolvedExplicit
  }

  if ($RunningPaths.Count -eq 0) {
    throw "After Effects is running, but its executable path could not be resolved. Rerun with -AfterFxPath pointing to the already running AfterFX.exe."
  }

  if ($RunningPaths.Count -gt 1) {
    $List = $RunningPaths -join "`n - "
    throw "Multiple After Effects installations are running. Close all but the intended target, or rerun with -AfterFxPath matching one of these already running executables:`n - $List"
  }

  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ProofScript -PathType Leaf)) { throw "M2 proof script not found: $ProofScript" }

$AfterFx = Resolve-RunningAfterFx $AfterFxPath
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }

$VersionInfo = (Get-Item $AfterFx).VersionInfo
Write-Host "EditFlow 2.0 M2 real-AE proof"
Write-Host "Running After Effects: $AfterFx"
if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
Write-Host "Proof script:          $ProofScript"

$Arguments = @("-r", ('"' + $ProofScript + '"'))
Start-Process -FilePath $AfterFx -ArgumentList $Arguments | Out-Null

$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $ResultPath -PathType Leaf)) {
  if ((Get-Date) -ge $Deadline) {
    throw "Timed out waiting for M2 result.json from the already running After Effects host. In that exact AE version, enable Edit > Preferences > Scripting & Expressions > Allow Scripts To Write Files And Access Network, then rerun."
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
