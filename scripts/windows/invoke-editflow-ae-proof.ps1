param(
  [Parameter(Mandatory = $true)][string]$RequestPath,
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SupervisorPath = Join-Path $RepoRoot "scripts\windows\ae-host-supervisor.ps1"
$AllowedLifecycles = @("REUSE_AE", "REOPEN_PROJECT", "RECONNECT_BROKER", "RESTART_AE", "CLEAN_BOOT")
$SupervisorProcess = $null
$StartedAt = (Get-Date).ToUniversalTime().ToString("o")
$AeReused = $false
$AeLaunched = $false
$AeRestarted = $false
$TargetAePid = $null
$ProofExitCode = $null
$RetryCount = 0
$FinalClassification = "INFRASTRUCTURE_FAILURE"
$FinalMessage = "Proof orchestration did not complete."
$ArtifactPath = $null
$OrchestrationResultPath = $null
$ProofResultPath = $null
$Request = $null

function ConvertTo-SafeRelativePath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  if ([System.IO.Path]::IsPathRooted($RelativePath)) { throw "Absolute paths are not allowed in proof requests: $RelativePath" }
  $Segments = $RelativePath -split '[\\/]'
  if (@($Segments | Where-Object { $_ -eq ".." }).Count -gt 0) { throw "Parent traversal is not allowed in proof requests: $RelativePath" }
  return ($RelativePath -replace '/', '\')
}

function Get-TargetAfterFxProcesses {
  param([Parameter(Mandatory = $true)][string]$ExpectedPath)
  $ResolvedExpected = (Resolve-Path $ExpectedPath).Path
  $Matches = @()
  foreach ($Process in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
    $CandidatePath = $null
    try { $CandidatePath = (Resolve-Path $Process.Path).Path } catch {}
    if ($CandidatePath -and [StringComparer]::OrdinalIgnoreCase.Equals($CandidatePath, $ResolvedExpected)) {
      $Matches += $Process
    }
  }
  return @($Matches)
}

function Get-HealthyTargetAfterFx {
  param([Parameter(Mandatory = $true)][string]$ExpectedPath)
  $Healthy = @()
  foreach ($Process in @(Get-TargetAfterFxProcesses -ExpectedPath $ExpectedPath)) {
    try {
      $Process.Refresh()
      if ($Process.Responding -and $Process.MainWindowHandle -ne 0 -and $Process.MainWindowTitle -like "Adobe After Effects*") {
        $Healthy += $Process
      }
    } catch {}
  }
  return @($Healthy)
}

function Wait-ForHealthyAfterFx {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedPath,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $Healthy = @(Get-HealthyTargetAfterFx -ExpectedPath $ExpectedPath)
    if ($Healthy.Count -eq 1) { return $Healthy[0] }
    if ($Healthy.Count -gt 1) { throw "More than one healthy target After Effects project window is present; refusing ambiguous automation." }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $Deadline)
  return $null
}

function Start-WarmAfterFx {
  param([Parameter(Mandatory = $true)][string]$ExpectedPath)

  # GitHub's self-hosted runner tags job descendants with RUNNER_TRACKING_ID and
  # kills those descendants during post-job orphan cleanup. A warm AE process is
  # intentionally workstation-scoped, not job-scoped. Clear only that tracking
  # variable for the exact AfterFX launch, then immediately restore it so proof
  # runners, the supervisor, and every other child remain normal job processes.
  $HadTrackingId = Test-Path Env:RUNNER_TRACKING_ID
  $PreviousTrackingId = $env:RUNNER_TRACKING_ID
  try {
    $env:RUNNER_TRACKING_ID = ""
    return Start-Process -FilePath $ExpectedPath -PassThru
  } finally {
    if ($HadTrackingId) { $env:RUNNER_TRACKING_ID = $PreviousTrackingId }
    else { Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue }
  }
}

function Stop-TargetAfterFx {
  param([Parameter(Mandatory = $true)][string]$ExpectedPath)
  $Targets = @(Get-TargetAfterFxProcesses -ExpectedPath $ExpectedPath)
  if ($Targets.Count -eq 0) { return }

  foreach ($Target in $Targets) {
    try { [void]$Target.CloseMainWindow() } catch {}
  }

  $GraceDeadline = (Get-Date).AddSeconds(10)
  do {
    $Remaining = @(Get-TargetAfterFxProcesses -ExpectedPath $ExpectedPath)
    if ($Remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $GraceDeadline)

  # Force-stop is reachable only through lifecycle modes that explicitly authorize
  # an AE process restart/clean boot. REUSE_AE never calls this function.
  foreach ($RemainingTarget in @(Get-TargetAfterFxProcesses -ExpectedPath $ExpectedPath)) {
    Stop-Process -Id $RemainingTarget.Id -Force -ErrorAction SilentlyContinue
  }

  $SettlementDeadline = (Get-Date).AddSeconds(10)
  do {
    if (@(Get-TargetAfterFxProcesses -ExpectedPath $ExpectedPath).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $SettlementDeadline)

  throw "Target After Effects process did not stop after an explicitly authorized restart request."
}

function Write-OrchestrationResult {
  param([Parameter(Mandatory = $true)][string]$Classification, [Parameter(Mandatory = $true)][string]$Message)
  if (-not $OrchestrationResultPath) { return }
  $CompletedAt = (Get-Date).ToUniversalTime().ToString("o")
  $Result = [ordered]@{
    proofId = if ($Request) { [string]$Request.proofId } else { $null }
    lifecycle = if ($Request) { [string]$Request.lifecycle } else { $null }
    classification = $Classification
    ok = ($Classification -eq "PASS")
    startedAt = $StartedAt
    completedAt = $CompletedAt
    aeReused = $AeReused
    aeLaunched = $AeLaunched
    aeRestarted = $AeRestarted
    aePid = $TargetAePid
    proofExitCode = $ProofExitCode
    retryCount = $RetryCount
    proofResultPath = if ($ProofResultPath) { $ProofResultPath.Substring($RepoRoot.Length).TrimStart('\') -replace '\\','/' } else { $null }
    orchestrationResultPath = $OrchestrationResultPath.Substring($RepoRoot.Length).TrimStart('\') -replace '\\','/'
    message = $Message
  }
  $Json = $Result | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($OrchestrationResultPath, $Json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-ProofClassification {
  if (-not $ProofResultPath -or -not (Test-Path $ProofResultPath -PathType Leaf)) { return $null }
  try {
    $ProofResult = Get-Content $ProofResultPath -Raw | ConvertFrom-Json
    $Classification = [string]$ProofResult.classification
    if ($Classification -in @("PASS", "PRODUCT_FAILURE", "INFRASTRUCTURE_FAILURE")) { return $ProofResult }
  } catch {}
  return $null
}

function Invoke-ProofAttempt {
  param([Parameter(Mandatory = $true)][string]$ProofPath, [Parameter(Mandatory = $true)][int]$TimeoutSeconds)

  $Arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $ProofPath + '"'),
    "-AfterFxPath", ('"' + $AfterFxPath + '"'),
    "-TimeoutSeconds", [string]$TimeoutSeconds
  ) -join " "

  $Process = Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  $Completed = $false
  try {
    Wait-Process -Id $Process.Id -Timeout $TimeoutSeconds -ErrorAction Stop
    $Completed = $true
  } catch {
    $Completed = $false
  }

  if (-not $Completed) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ exitCode = 124; timedOut = $true }
  }

  $Process.Refresh()
  return [pscustomobject]@{ exitCode = [int]$Process.ExitCode; timedOut = $false }
}

try {
  if (-not [Environment]::UserInteractive) { throw "The accelerated AE proof harness requires an interactive Windows desktop session." }
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found at: $AfterFxPath" }
  if (-not (Test-Path $SupervisorPath -PathType Leaf)) { throw "AE host supervisor is missing: $SupervisorPath" }
  if ($StartupTimeoutSeconds -lt 20 -or $StartupTimeoutSeconds -gt 180) { throw "StartupTimeoutSeconds must be between 20 and 180." }

  $ResolvedRequestPath = (Resolve-Path $RequestPath).Path
  if (-not $ResolvedRequestPath.StartsWith($RepoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Proof request must be inside the checked-out repository."
  }
  $Request = Get-Content $ResolvedRequestPath -Raw | ConvertFrom-Json

  if (-not $Request.proofId -or [string]$Request.proofId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Invalid proofId." }
  if ([string]$Request.lifecycle -notin $AllowedLifecycles) { throw "Unsupported AE lifecycle: $($Request.lifecycle)" }
  if ([int]$Request.timeoutSeconds -lt 10 -or [int]$Request.timeoutSeconds -gt 3600) { throw "timeoutSeconds must be between 10 and 3600." }
  if ([string]$Request.proofScript -notmatch '^scripts/windows/run-[A-Za-z0-9._-]+\.ps1$') { throw "proofScript is outside the allow-listed run-*.ps1 surface." }
  if ([string]$Request.artifactDir -notmatch '^proofs/artifacts/[A-Za-z0-9][A-Za-z0-9._/-]*$') { throw "artifactDir must be below proofs/artifacts/." }

  $ProofRelative = ConvertTo-SafeRelativePath -RelativePath ([string]$Request.proofScript)
  $ArtifactRelative = ConvertTo-SafeRelativePath -RelativePath ([string]$Request.artifactDir)
  $ProofPath = Join-Path $RepoRoot $ProofRelative
  $ArtifactPath = Join-Path $RepoRoot $ArtifactRelative
  if (-not (Test-Path $ProofPath -PathType Leaf)) { throw "Requested proof script does not exist: $ProofPath" }
  New-Item -ItemType Directory -Force -Path $ArtifactPath | Out-Null

  $ResultFile = if ($Request.resultFile) { [string]$Request.resultFile } else { "result.json" }
  if ($ResultFile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.json$') { throw "Invalid resultFile." }
  $ProofResultPath = Join-Path $ArtifactPath $ResultFile
  $OrchestrationResultPath = Join-Path $ArtifactPath "orchestration-result.json"
  $SupervisorLogPath = Join-Path $ArtifactPath "ae-host-supervisor.log"

  $env:EDITFLOW_AE_LIFECYCLE = [string]$Request.lifecycle
  $env:EDITFLOW_AE_WARM_SESSION = "1"
  $env:EDITFLOW_AFTERFX_PATH = (Resolve-Path $AfterFxPath).Path
  $env:EDITFLOW_PROOF_ID = [string]$Request.proofId
  $env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactPath

  $SupervisorWatch = [Math]::Min(7200, [Math]::Max(120, [int]$Request.timeoutSeconds + $StartupTimeoutSeconds + 30))
  $SupervisorArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$SupervisorPath`" -AfterFxPath `"$AfterFxPath`" -LogPath `"$SupervisorLogPath`" -WatchSeconds $SupervisorWatch"
  $SupervisorProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $SupervisorArgs -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  $SupervisorProcess.Refresh()
  if ($SupervisorProcess.HasExited) { throw "AE host supervisor exited during startup." }

  $Lifecycle = [string]$Request.lifecycle
  if ($Lifecycle -in @("RESTART_AE", "CLEAN_BOOT")) {
    $HadTarget = @(Get-TargetAfterFxProcesses -ExpectedPath $AfterFxPath).Count -gt 0
    Stop-TargetAfterFx -ExpectedPath $AfterFxPath
    $AeRestarted = $HadTarget
    [void](Start-WarmAfterFx -ExpectedPath $AfterFxPath)
    $AeLaunched = $true
  } else {
    $ExistingTargets = @(Get-TargetAfterFxProcesses -ExpectedPath $AfterFxPath)
    if ($ExistingTargets.Count -eq 0) {
      [void](Start-WarmAfterFx -ExpectedPath $AfterFxPath)
      $AeLaunched = $true
    } else {
      $AeReused = $true
    }
  }

  $Target = Wait-ForHealthyAfterFx -ExpectedPath $AfterFxPath -TimeoutSeconds $StartupTimeoutSeconds
  if (-not $Target) {
    if ($AeReused) { throw "Existing target After Effects session did not become healthy; REUSE_AE refuses silent restart escalation." }
    throw "After Effects did not expose one healthy project window before the startup timeout."
  }
  $TargetAePid = [int]$Target.Id

  $MaxAttempts = if ([bool]$Request.allowInfrastructureRetry) { 2 } else { 1 }
  for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
    if (Test-Path $ProofResultPath -PathType Leaf) { Remove-Item $ProofResultPath -Force }

    $AttemptResult = Invoke-ProofAttempt -ProofPath $ProofPath -TimeoutSeconds ([int]$Request.timeoutSeconds)
    $ProofExitCode = [int]$AttemptResult.exitCode
    $ProofResult = Read-ProofClassification

    if (-not $AttemptResult.timedOut -and $ProofExitCode -eq 0 -and $ProofResult -and [string]$ProofResult.classification -eq "PASS") {
      $HealthyAfter = @(Get-HealthyTargetAfterFx -ExpectedPath $AfterFxPath)
      if ($HealthyAfter.Count -ne 1) {
        $FinalClassification = "PRODUCT_FAILURE"
        $FinalMessage = "Proof returned PASS but did not preserve exactly one healthy warm After Effects session."
      } else {
        $TargetAePid = [int]$HealthyAfter[0].Id
        $FinalClassification = "PASS"
        $FinalMessage = "Proof passed and the warm After Effects session remains healthy."
      }
      break
    }

    if ($AttemptResult.timedOut) {
      $FinalClassification = "INFRASTRUCTURE_FAILURE"
      $FinalMessage = "Proof process exceeded its declared timeout."
      break
    }

    if ($ProofResult) {
      $FinalClassification = [string]$ProofResult.classification
      $FinalMessage = if ($ProofResult.message) { [string]$ProofResult.message } else { "Proof returned $FinalClassification." }
    } else {
      # Unknown nonzero results are treated as product failures so they cannot be
      # silently retried as infrastructure noise.
      $FinalClassification = "PRODUCT_FAILURE"
      $FinalMessage = "Proof exited nonzero without a valid machine-readable classification."
    }

    $RetrySafe = $false
    if ($ProofResult -and $FinalClassification -eq "INFRASTRUCTURE_FAILURE") {
      $MutationStarted = [bool]$ProofResult.mutationStarted
      $CleanupComplete = [bool]$ProofResult.cleanupComplete
      $RetrySafe = (-not $MutationStarted) -or $CleanupComplete
    }

    if ($Attempt -lt $MaxAttempts -and $RetrySafe) {
      $WarmHealthy = @(Get-HealthyTargetAfterFx -ExpectedPath $AfterFxPath)
      if ($WarmHealthy.Count -ne 1) {
        $FinalMessage = "Infrastructure retry refused because the declared lifecycle no longer has one healthy AE session."
        break
      }
      $RetryCount += 1
      Start-Sleep -Milliseconds 500
      continue
    }
    break
  }

  Write-OrchestrationResult -Classification $FinalClassification -Message $FinalMessage
  if ($FinalClassification -ne "PASS") { exit 1 }
} catch {
  $FinalClassification = "INFRASTRUCTURE_FAILURE"
  $FinalMessage = $_.Exception.Message
  if ($ArtifactPath -and -not $OrchestrationResultPath) {
    $OrchestrationResultPath = Join-Path $ArtifactPath "orchestration-result.json"
  }
  Write-OrchestrationResult -Classification $FinalClassification -Message $FinalMessage
  Write-Error $FinalMessage
  exit 1
} finally {
  if ($SupervisorProcess) {
    try {
      $SupervisorProcess.Refresh()
      if (-not $SupervisorProcess.HasExited) {
        Stop-Process -Id $SupervisorProcess.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Remove-Item Env:EDITFLOW_AE_LIFECYCLE -ErrorAction SilentlyContinue
  Remove-Item Env:EDITFLOW_AE_WARM_SESSION -ErrorAction SilentlyContinue
  Remove-Item Env:EDITFLOW_AFTERFX_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:EDITFLOW_PROOF_ID -ErrorAction SilentlyContinue
  Remove-Item Env:EDITFLOW_PROOF_ARTIFACT_DIR -ErrorAction SilentlyContinue
}
