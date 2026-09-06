param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 240,
  [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProofScript = Join-Path $RepoRoot "proofs\ae\m2-disposable-p4-p5-proof.jsx"
$BootstrapTemplate = Join-Path $RepoRoot "scripts\windows\m2-p45-startup-bootstrap-template.jsx"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-disposable-p4-p5"
$ResultPath = Join-Path $ArtifactDir "result.json"
$BootstrapLog = Join-Path $ArtifactDir "bootstrap.log"
$InstalledBootstrap = $null
$LaunchProcess = $null

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

function Escape-JsxString {
  param([string]$Value)
  return $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
}

function Publish-BootstrapEvidence {
  if (Test-Path $BootstrapLog -PathType Leaf) {
    Write-Host "EditFlow M2 P4/P5 Startup bootstrap evidence:"
    Get-Content $BootstrapLog -Raw | Write-Host
  } else {
    Write-Warning "No M2 P4/P5 Startup bootstrap evidence was produced."
  }
}

if (-not [Environment]::UserInteractive) {
  throw "The EditFlow AE runner must run in an interactive Windows user session. Start the GitHub Actions runner with run.cmd while logged into the desktop; do not run it as a Windows service."
}
if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }
if ($StartupTimeoutSeconds -lt 10) { throw "StartupTimeoutSeconds must be at least 10." }
if (-not (Test-Path $ProofScript -PathType Leaf)) { throw "M2 P4/P5 proof script not found: $ProofScript" }
if (-not (Test-Path $BootstrapTemplate -PathType Leaf)) { throw "M2 P4/P5 Startup bootstrap template not found: $BootstrapTemplate" }

$AfterFx = Resolve-AfterFx $AfterFxPath
$AfterFxVersionInfo = (Get-Item $AfterFx).VersionInfo
if ($AfterFxVersionInfo.FileMajorPart -lt 1) { throw "Unable to resolve the After Effects major/minor version for the user Startup script path." }
$AfterFxVersionFolder = ("{0}.{1}" -f $AfterFxVersionInfo.FileMajorPart, $AfterFxVersionInfo.FileMinorPart)
$UserStartupDir = Join-Path $env:APPDATA ("Adobe\After Effects\" + $AfterFxVersionFolder + "\Scripts\Startup")
$InstalledBootstrap = Join-Path $UserStartupDir "EditFlow2-m2-p45-bootstrap.jsx"

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  $Ids = ($ExistingAfterFx | ForEach-Object { $_.Id }) -join ","
  throw "Refusing disposable P4/P5 cold-start proof because After Effects is already running (PID(s): $Ids). Close AE first; no writes were attempted."
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
New-Item -ItemType Directory -Force -Path $UserStartupDir | Out-Null
if (Test-Path $ResultPath -PathType Leaf) { Remove-Item $ResultPath -Force }
if (Test-Path $BootstrapLog -PathType Leaf) { Remove-Item $BootstrapLog -Force }
if (Test-Path $InstalledBootstrap -PathType Leaf) { Remove-Item $InstalledBootstrap -Force }

$BootstrapSource = Get-Content $BootstrapTemplate -Raw
$BootstrapSource = $BootstrapSource.Replace("__EDITFLOW_PROOF_PATH__", (Escape-JsxString $ProofScript))
$BootstrapSource = $BootstrapSource.Replace("__EDITFLOW_RESULT_PATH__", (Escape-JsxString $ResultPath))
$BootstrapSource = $BootstrapSource.Replace("__EDITFLOW_LOG_PATH__", (Escape-JsxString $BootstrapLog))
$BootstrapSource = $BootstrapSource.Replace("__EDITFLOW_BOOTSTRAP_PATH__", (Escape-JsxString $InstalledBootstrap))
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($InstalledBootstrap, $BootstrapSource, $Utf8NoBom)

Write-Warning "DESTRUCTIVE DISPOSABLE-PROJECT GATE: AE will cold-start under runner ownership and the proof REFUSES before mutations unless the new project is unsaved and has zero items."
Write-Host "The proof saves only its disposable project under proofs/artifacts, closes/reopens it, then leaves a new blank project before runner cleanup."
Write-Host ("After Effects: " + $AfterFx)
Write-Host ("Startup bootstrap: " + $InstalledBootstrap)
Write-Host ("Proof script: " + $ProofScript)

try {
  $LaunchProcess = Start-Process -FilePath $AfterFx -PassThru
  Write-Host ("Launched declared M2 target After Effects through cold-start bootstrap; launcher PID " + $LaunchProcess.Id + ".")

  $StartupDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $StartupDeadline -and -not (Test-Path $BootstrapLog -PathType Leaf)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path $BootstrapLog -PathType Leaf)) {
    throw "After Effects launched but the temporary M2 P4/P5 Startup bootstrap produced no evidence within $StartupTimeoutSeconds seconds."
  }

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-Path $ResultPath -PathType Leaf)) {
    if ((Get-Date) -ge $Deadline) {
      throw "Timed out waiting for P4/P5 result.json after the Startup bootstrap executed."
    }
    Start-Sleep -Milliseconds 500
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("M2 P4/P5 status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($Result.projectArtifact) { Write-Host ("Disposable project artifact: " + $Result.projectArtifact) }

  if ($Result.status -eq "REFUSED") {
    throw "P4/P5 proof refused safely because the cold-start AE project was not blank, unsaved, and zero-item. No proof mutations were performed."
  }
  if (-not $Result.ok) {
    if ($Result.error) { Write-Error $Result.error }
    throw "M2 P4/P5 real-AE proof failed. Inspect the uploaded result and bootstrap evidence before retrying."
  }
} finally {
  if ($InstalledBootstrap -and (Test-Path $InstalledBootstrap -PathType Leaf)) {
    Remove-Item $InstalledBootstrap -Force -ErrorAction SilentlyContinue
  }
  Publish-BootstrapEvidence

  # The preflight above proved there were zero AE processes before this run. Every
  # AfterFX process present now belongs to this bounded proof, including any child
  # process that replaced the PID returned by Start-Process.
  $OwnedProcesses = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($OwnedProcesses.Count -gt 0) {
    $OwnedIds = ($OwnedProcesses | ForEach-Object { $_.Id }) -join ","
    Write-Host ("Stopping runner-owned After Effects proof process set: " + $OwnedIds)
    $OwnedProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    foreach ($Owned in $OwnedProcesses) {
      Wait-Process -Id $Owned.Id -Timeout 15 -ErrorAction SilentlyContinue
    }
  }
}

exit 0
