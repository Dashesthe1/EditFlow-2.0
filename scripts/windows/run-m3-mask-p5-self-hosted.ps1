param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [int]$StartupTimeoutSeconds = 45,
  [int]$MaxColdStartAttempts = 2,
  [int]$BootstrapEvidenceTimeoutSeconds = 30,
  [int]$CommandDeliveryStabilizationSeconds = 6
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$Acceptance = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p5.ps1"
$PanelBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$PanelBootstrapLog = Join-Path $env:TEMP "EditFlow2-self-hosted-panel-bootstrap.log"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-mask-p5-transfer"
$PublishedPanelBootstrapLog = Join-Path $ArtifactDir "panel-bootstrap.log"
$StartupDiagnosticsPath = Join-Path $ArtifactDir "startup-diagnostics.log"
$StartedAfterFx = $false

function Write-Diagnostic {
  param([string]$Stage, [string]$Detail)
  $Timestamp = (Get-Date).ToUniversalTime().ToString("o")
  Add-Content -Path $StartupDiagnosticsPath -Value ($Timestamp + "`t" + $Stage + "`t" + $Detail) -Encoding UTF8
}

function Find-ReadyAfterFx {
  param([string]$ExpectedPath)
  $ResolvedExpected = (Resolve-Path $ExpectedPath).Path
  foreach ($Candidate in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    try {
      $CandidatePath = $Candidate.Path
      $Title = $Candidate.MainWindowTitle
      $Ready = $Candidate.Responding -and $Candidate.MainWindowHandle -ne 0 -and $Title -and $Title -like "Adobe After Effects*"
      if ($CandidatePath -and $Ready -and [StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $CandidatePath).Path, $ResolvedExpected)) {
        return $Candidate
      }
    } catch {}
  }
  return $null
}

function Write-ProcessSnapshot {
  param([string]$Stage)
  $Processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  Write-Diagnostic $Stage ("aeCount=" + $Processes.Count)
  foreach ($Process in $Processes) {
    $Title = ""
    $Path = ""
    $Responding = $false
    try { $Title = $Process.MainWindowTitle } catch {}
    try { $Path = $Process.Path } catch {}
    try { $Responding = $Process.Responding } catch {}
    Write-Diagnostic $Stage ("pid=$($Process.Id);sessionId=$($Process.SessionId);responding=$Responding;title=$Title;path=$Path")
  }
}

function Stop-OwnedAfterFxSet {
  param([string]$StagePrefix)
  $Processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Processes.Count -eq 0) {
    Write-Diagnostic ($StagePrefix + "_ZERO") "aeCount=0"
    return
  }

  $Ids = ($Processes | ForEach-Object { $_.Id }) -join ","
  Write-Diagnostic ($StagePrefix + "_BEGIN") ("pids=" + $Ids)
  foreach ($Process in $Processes) {
    try { [void]$Process.CloseMainWindow() } catch {}
  }

  $Deadline = (Get-Date).AddSeconds(10)
  do {
    $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    if ($Remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $Deadline)

  $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Remaining.Count -gt 0) {
    $RemainingIds = ($Remaining | ForEach-Object { $_.Id }) -join ","
    Write-Warning ("Graceful AE close did not finish; force-stopping only the zero-baseline runner-owned process set: " + $RemainingIds)
    Write-Diagnostic ($StagePrefix + "_FORCE") ("pids=" + $RemainingIds)
    $Remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    $SettleDeadline = (Get-Date).AddSeconds(5)
    do {
      $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($Remaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $SettleDeadline)
  }

  $Remaining = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Remaining.Count -gt 0) {
    throw "Runner-owned After Effects process set did not return to zero after bounded cleanup: $(($Remaining | ForEach-Object { $_.Id }) -join ',')"
  }
  Write-Diagnostic ($StagePrefix + "_ZERO") "aeCount=0"
}

function Publish-Evidence {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $PanelBootstrapLog -PathType Leaf) {
    Copy-Item $PanelBootstrapLog $PublishedPanelBootstrapLog -Force
    Get-Content $PanelBootstrapLog -Raw | Write-Host
  }
  if (Test-Path $StartupDiagnosticsPath -PathType Leaf) {
    Get-Content $StartupDiagnosticsPath -Raw | Write-Host
  }
}

if (-not [Environment]::UserInteractive) {
  throw "The EditFlow AE runner must run in an interactive Windows user session; do not run it as a Windows service."
}
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found at: $AfterFxPath" }
if (-not (Test-Path $Installer -PathType Leaf)) { throw "EditFlow CEP installer is missing: $Installer" }
if (-not (Test-Path $Acceptance -PathType Leaf)) { throw "M3 P5 acceptance wrapper is missing: $Acceptance" }
if (-not (Test-Path $PanelBootstrap -PathType Leaf)) { throw "Fixed EditFlow panel bootstrap is missing: $PanelBootstrap" }
if ($PanelBootstrap -match "\s") { throw "The fixed AE -r bootstrap path contains whitespace: $PanelBootstrap" }
if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if ($StartupTimeoutSeconds -lt 20) { throw "StartupTimeoutSeconds must be at least 20." }
if ($MaxColdStartAttempts -lt 1 -or $MaxColdStartAttempts -gt 2) { throw "MaxColdStartAttempts must be 1 or 2." }
if ($BootstrapEvidenceTimeoutSeconds -lt 5) { throw "BootstrapEvidenceTimeoutSeconds must be at least 5." }
if ($CommandDeliveryStabilizationSeconds -lt 1) { throw "CommandDeliveryStabilizationSeconds must be at least 1." }

$ExistingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($ExistingAfterFx.Count -gt 0) {
  throw "Automated M3 P5 self-hosted proof refuses to touch an already-running After Effects session. Save/close any AE work and exit After Effects before this proof runs."
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $PanelBootstrapLog -PathType Leaf) { Remove-Item $PanelBootstrapLog -Force }
if (Test-Path $PublishedPanelBootstrapLog -PathType Leaf) { Remove-Item $PublishedPanelBootstrapLog -Force }
if (Test-Path $StartupDiagnosticsPath -PathType Leaf) { Remove-Item $StartupDiagnosticsPath -Force }

$RunnerProcess = Get-Process -Id $PID
$RunnerIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-Diagnostic "PRELAUNCH" ("runnerIdentity=$RunnerIdentity;runnerPid=$PID;runnerSessionId=$($RunnerProcess.SessionId);afterFx=$AfterFxPath")

Write-Host "Installing the checked-out EditFlow CEP bridge before launching the isolated M3 P5 AE proof..."
& $Installer

# Both the runner-owned AE process and every proof-only -r script launched later
# inherit this exact flag. The proof scripts refuse to operate without it.
$env:EDITFLOW_M3_MASK_P5_PROOF = "1"
Write-Diagnostic "P5_PROOF_ARMED" "env=EDITFLOW_M3_MASK_P5_PROOF"

try {
  $RunningAfterFx = $null
  for ($Attempt = 1; $Attempt -le $MaxColdStartAttempts; $Attempt++) {
    Write-Host ("Cold-launching After Effects for M3 P5 attempt " + $Attempt + "/" + $MaxColdStartAttempts + "...")
    Write-Diagnostic "COLD_START_BEGIN" ("attempt=$Attempt")
    $LaunchProcess = Start-Process -FilePath $AfterFxPath -PassThru
    $StartedAfterFx = $true
    Write-Diagnostic "COLD_START_REQUEST" ("attempt=$Attempt;pid=$($LaunchProcess.Id)")

    $Deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
      $RunningAfterFx = Find-ReadyAfterFx $AfterFxPath
      if ($null -ne $RunningAfterFx) { break }
      Start-Sleep -Milliseconds 500
    }
    Write-ProcessSnapshot ("COLD_START_CHECK_" + $Attempt)
    if ($null -ne $RunningAfterFx) { break }

    if ($Attempt -lt $MaxColdStartAttempts) {
      Write-Warning "After Effects did not expose a titled project-ready window; recycling only the runner-owned zero-baseline process set for one retry."
      Stop-OwnedAfterFxSet -StagePrefix ("RETRY_" + $Attempt)
      Start-Sleep -Seconds 3
    }
  }

  if ($null -eq $RunningAfterFx) {
    throw "After Effects did not expose the proven titled project-ready window after $MaxColdStartAttempts bounded attempt(s)."
  }

  $ReadyPid = $RunningAfterFx.Id
  Write-Diagnostic "PROJECT_READY" ("pid=$ReadyPid;title=$($RunningAfterFx.MainWindowTitle)")
  Write-Host ("Project-ready After Effects window confirmed at PID " + $ReadyPid + ". Holding for " + $CommandDeliveryStabilizationSeconds + " seconds before panel bootstrap.")
  Start-Sleep -Seconds $CommandDeliveryStabilizationSeconds

  $StableAfterFx = Find-ReadyAfterFx $AfterFxPath
  if ($null -eq $StableAfterFx -or $StableAfterFx.Id -ne $ReadyPid) {
    throw "The target After Effects project window did not remain stable through the panel-bootstrap hold."
  }

  $CommandProcess = Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $PanelBootstrap) -PassThru
  Write-Diagnostic "PANEL_BOOTSTRAP_DISPATCH" ("pid=$($CommandProcess.Id);targetPid=$ReadyPid")

  $BootstrapDeadline = (Get-Date).AddSeconds($BootstrapEvidenceTimeoutSeconds)
  $BootstrapSucceeded = $false
  while ((Get-Date) -lt $BootstrapDeadline) {
    if (Test-Path $PanelBootstrapLog -PathType Leaf) {
      $BootstrapText = Get-Content $PanelBootstrapLog -Raw
      if ($BootstrapText -match "RETRY_EXHAUSTED") {
        throw "The fixed After Effects panel bootstrap exhausted its menu-open retries."
      }
      if ($BootstrapText -match "EXECUTE_COMMAND_SENT") {
        $BootstrapSucceeded = $true
        break
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $BootstrapSucceeded) {
    throw "After Effects did not produce fixed-bootstrap EXECUTE_COMMAND_SENT evidence within $BootstrapEvidenceTimeoutSeconds seconds."
  }

  Write-Host "Fixed panel bootstrap executed. Starting the M3 P5 authenticated transfer harness..."
  & $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue
  Write-Diagnostic "P5_PROOF_DISARMED" "env=EDITFLOW_M3_MASK_P5_PROOF"
  Write-ProcessSnapshot "CLEANUP_BEGIN"
  try {
    if ($StartedAfterFx) { Stop-OwnedAfterFxSet -StagePrefix "FINAL_CLEANUP" }
  } finally {
    Publish-Evidence
  }
}
