param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180,
  [int]$StartupTimeoutSeconds = 90,
  [int]$BootstrapEvidenceTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$Acceptance = Join-Path $RepoRoot "scripts\windows\run-m2-ae-acceptance.ps1"
$PanelBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$PanelBootstrapLog = Join-Path $env:TEMP "EditFlow2-self-hosted-panel-bootstrap.log"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$PublishedPanelBootstrapLog = Join-Path $ArtifactDir "panel-bootstrap.log"
$AfterFxVersionInfo = (Get-Item $AfterFxPath).VersionInfo
$AfterFxVersionFolder = ("{0}.{1}" -f $AfterFxVersionInfo.FileMajorPart, $AfterFxVersionInfo.FileMinorPart)
$UserScriptsRoot = Join-Path $env:APPDATA ("Adobe\After Effects\" + $AfterFxVersionFolder + "\Scripts")
$UserStartupDir = Join-Path $UserScriptsRoot "Startup"
$InstalledPanelBootstrap = Join-Path $UserStartupDir "EditFlow2-self-hosted-bootstrap.jsx"

function Publish-PanelBootstrapEvidence {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $PanelBootstrapLog -PathType Leaf) {
    Copy-Item $PanelBootstrapLog $PublishedPanelBootstrapLog -Force
    Write-Host "EditFlow self-hosted panel bootstrap evidence:"
    Get-Content $PanelBootstrapLog -Raw | Write-Host
  } else {
    Write-Warning "No EditFlow panel bootstrap evidence was produced. The temporary AE Startup script did not execute."
  }
}

if (-not [Environment]::UserInteractive) {
  throw "The EditFlow AE runner must run in an interactive Windows user session. Start the GitHub Actions runner with run.cmd while logged into the desktop; do not run it as a Windows service."
}
if (-not (Test-Path $AfterFxPath -PathType Leaf)) {
  throw "AfterFX.exe was not found at: $AfterFxPath"
}
if (-not (Test-Path $PanelBootstrap -PathType Leaf)) {
  throw "The fixed EditFlow CEP panel bootstrap is missing: $PanelBootstrap"
}
if ($AfterFxVersionInfo.FileMajorPart -lt 1) {
  throw "Unable to resolve the After Effects major/minor version for the user Startup script path."
}
if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if ($StartupTimeoutSeconds -lt 10) { throw "StartupTimeoutSeconds must be at least 10." }
if ($BootstrapEvidenceTimeoutSeconds -lt 5) { throw "BootstrapEvidenceTimeoutSeconds must be at least 5." }

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  throw "Automated self-hosted proof refuses to touch an already-running After Effects session. Save/close any AE work and exit After Effects before the runner starts a proof."
}

if (Test-Path $PanelBootstrapLog -PathType Leaf) { Remove-Item $PanelBootstrapLog -Force }
if (Test-Path $PublishedPanelBootstrapLog -PathType Leaf) { Remove-Item $PublishedPanelBootstrapLog -Force }
if (Test-Path $InstalledPanelBootstrap -PathType Leaf) { Remove-Item $InstalledPanelBootstrap -Force }

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated AE proof..."
& $Installer

New-Item -ItemType Directory -Force -Path $UserStartupDir | Out-Null
Copy-Item $PanelBootstrap $InstalledPanelBootstrap -Force
Write-Host ("Installed temporary AE Startup bootstrap: " + $InstalledPanelBootstrap)

$StartedAfterFx = $false
try {
  Write-Host "Launching a fresh After Effects instance; AE will load the temporary user Startup script during initialization..."
  Start-Process -FilePath $AfterFxPath | Out-Null
  $StartedAfterFx = $true

  $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $RunningAfterFx = $null
  while ((Get-Date) -lt $Deadline) {
    $Candidates = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    foreach ($Candidate in $Candidates) {
      $CandidatePath = $null
      $WindowReady = $false
      try {
        $CandidatePath = $Candidate.Path
        $WindowReady = $Candidate.MainWindowHandle -ne 0 -and $Candidate.Responding
      } catch {
        $CandidatePath = $null
        $WindowReady = $false
      }
      if ($CandidatePath -and $WindowReady -and ((Resolve-Path $CandidatePath).Path -eq (Resolve-Path $AfterFxPath).Path)) {
        $RunningAfterFx = $Candidate
        break
      }
    }
    if ($null -ne $RunningAfterFx) { break }
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $RunningAfterFx) {
    throw "After Effects did not expose a responsive interactive window within $StartupTimeoutSeconds seconds."
  }

  $BootstrapDeadline = (Get-Date).AddSeconds($BootstrapEvidenceTimeoutSeconds)
  while ((Get-Date) -lt $BootstrapDeadline -and -not (Test-Path $PanelBootstrapLog -PathType Leaf)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path $PanelBootstrapLog -PathType Leaf)) {
    throw "After Effects was running, but the temporary user Startup script did not produce evidence within $BootstrapEvidenceTimeoutSeconds seconds."
  }

  Write-Host "After Effects executed the temporary Startup bootstrap. The acceptance harness will wait for authenticated EditFlow bridge registration."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  if (Test-Path $InstalledPanelBootstrap -PathType Leaf) {
    Remove-Item $InstalledPanelBootstrap -Force -ErrorAction SilentlyContinue
  }
  Publish-PanelBootstrapEvidence
  if ($StartedAfterFx) {
    Write-Host "Stopping only the isolated After Effects test session started by this runner..."
    Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}
