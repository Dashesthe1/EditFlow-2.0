param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180,
  [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$Acceptance = Join-Path $RepoRoot "scripts\windows\run-m2-ae-acceptance.ps1"

if (-not [Environment]::UserInteractive) {
  throw "The EditFlow AE runner must run in an interactive Windows user session. Start the GitHub Actions runner with run.cmd while logged into the desktop; do not run it as a Windows service."
}
if (-not (Test-Path $AfterFxPath -PathType Leaf)) {
  throw "AfterFX.exe was not found at: $AfterFxPath"
}
if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if ($StartupTimeoutSeconds -lt 10) { throw "StartupTimeoutSeconds must be at least 10." }

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  throw "Automated self-hosted proof refuses to touch an already-running After Effects session. Save/close any AE work and exit After Effects before the runner starts a proof."
}

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated AE proof..."
& $Installer

$StartedAfterFx = $false
try {
  Write-Host "Launching a fresh After Effects instance for the self-hosted M2 proof..."
  Start-Process -FilePath $AfterFxPath | Out-Null
  $StartedAfterFx = $true

  $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $RunningAfterFx = $null
  while ((Get-Date) -lt $Deadline) {
    $Candidates = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    foreach ($Candidate in $Candidates) {
      $CandidatePath = $null
      try { $CandidatePath = $Candidate.Path } catch { $CandidatePath = $null }
      if ($CandidatePath -and ((Resolve-Path $CandidatePath).Path -eq (Resolve-Path $AfterFxPath).Path)) {
        $RunningAfterFx = $Candidate
        break
      }
    }
    if ($null -ne $RunningAfterFx) { break }
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $RunningAfterFx) {
    throw "After Effects did not start within $StartupTimeoutSeconds seconds."
  }

  Write-Host "After Effects is running. The CEP manifest is AutoVisible; the acceptance harness will wait for bridge registration."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  if ($StartedAfterFx) {
    Write-Host "Stopping only the isolated After Effects test session started by this runner..."
    Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}
