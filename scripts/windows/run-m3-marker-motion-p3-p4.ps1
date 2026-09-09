param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$PreparePreview = Join-Path $PSScriptRoot "prepare-m3-marker-motion-v20-preview.ps1"
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p3-p4" }
$ResultPath = Join-Path $ArtifactDir "result.json"
$ArmScriptPath = Join-Path $ArtifactDir "arm-marker-motion-p4.jsx"
$DisarmScriptPath = Join-Path $ArtifactDir "disarm-marker-motion-p4.jsx"
$ArmSentinelPath = Join-Path $ArtifactDir "host-arm-sentinel.txt"
$TargetPid = $null
$ArmAttempted = $false
$ProofSucceeded = $false
$FailureMessage = $null
$NodeProcess = $null

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running; the accelerated harness must establish the warm process first." }
  $ResolvedExplicit = $null
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
  }
  $Matches = @()
  foreach ($Process in $Running) {
    try {
      $Candidate = (Resolve-Path $Process.Path).Path
      if (-not $ResolvedExplicit -or [StringComparer]::OrdinalIgnoreCase.Equals($Candidate, $ResolvedExplicit)) { $Matches += $Process }
    } catch {}
  }
  if ($Matches.Count -ne 1) { throw "Marker-motion P3/P4 requires exactly one unambiguous running After Effects process." }
  return [pscustomobject]@{ Process = $Matches[0]; Path = (Resolve-Path $Matches[0].Path).Path }
}

function Write-BootstrapScript {
  param([string]$ScriptPath, [string]$HostPath, [string]$SentinelPath, [bool]$Arm)
  $HostLiteral = (($HostPath -replace '\\','/') | ConvertTo-Json -Compress)
  $SentinelLiteral = (($SentinelPath -replace '\\','/') | ConvertTo-Json -Compress)
  if ($Arm) {
    $Text = @"
(function () {
  try {
    var hostFile = new File($HostLiteral);
    if (!hostFile.exists) throw new Error("marker-motion host file missing: " + hostFile.fsName);
    $.evalFile(hostFile);
    if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_HOST_PROTOCOL_20 !== true) throw new Error("protocol 2.0 marker-motion dispatcher did not register");
    $.global.EditFlow2_M3_MARKER_MOTION_P4_PROOF = true;
    var sentinel = new File($SentinelLiteral);
    if (!sentinel.open("w")) throw new Error("unable to open arm sentinel");
    sentinel.write("OK");
    sentinel.close();
  } catch (error) {
    try {
      var failure = new File($SentinelLiteral);
      if (failure.open("w")) { failure.write("ERROR:" + String(error)); failure.close(); }
    } catch (_) {}
  }
}());
"@
  } else {
    $Text = @"
(function () {
  try { $.global.EditFlow2_M3_MARKER_MOTION_P4_PROOF = false; } catch (_) {}
}());
"@
  }
  [System.IO.File]::WriteAllText($ScriptPath, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-ExistingAeScript {
  param([string]$AfterFx, [string]$ScriptPath)
  $Arguments = @("-r", ('"' + $ScriptPath + '"'))
  $Launcher = Start-Process -FilePath $AfterFx -ArgumentList $Arguments -PassThru
  try { Wait-Process -Id $Launcher.Id -Timeout 20 -ErrorAction SilentlyContinue } catch {}
}

function Wait-ForArmSentinel {
  param([int]$Seconds)
  $Deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (Test-Path $ArmSentinelPath -PathType Leaf) {
      $Value = [System.IO.File]::ReadAllText($ArmSentinelPath)
      if ($Value -eq "OK") { return }
      if ($Value.StartsWith("ERROR:")) { throw ("Warm host bootstrap failed: " + $Value.Substring(6)) }
    }
    Start-Sleep -Milliseconds 150
  } while ((Get-Date) -lt $Deadline)
  throw "Warm host bootstrap did not produce its sentinel before timeout."
}

function Write-InfrastructureFailureIfMissing {
  param([string]$Message)
  if (Test-Path $ResultPath -PathType Leaf) { return }
  $Result = [ordered]@{
    proofId = "M3_MARKER_MOTION_P3_P4_REAL_AE"
    status = "FAILURE"
    classification = "INFRASTRUCTURE_FAILURE"
    ok = $false
    message = $Message
    mutationStarted = $false
    cleanupComplete = $true
    proofLevels = [ordered]@{
      P1_validation_rejection = $true
      P2_structural_readback = $true
      P3_visual_proof = $false
      P4_failure_injection_rollback = $false
      P5_save_reopen_reconnect_transfer = $false
    }
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath -PathType Leaf) { Remove-Item $ResultPath -Force }
if (Test-Path $ArmSentinelPath -PathType Leaf) { Remove-Item $ArmSentinelPath -Force }

$Running = Resolve-RunningAfterFx $AfterFxPath
$AfterFx = $Running.Path
$TargetPid = [int]$Running.Process.Id
$HostPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_marker_motion.jsx"

try {
  if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP runtime config is missing." }
  if (-not (Test-Path $PreparePreview -PathType Leaf)) { throw "Protocol 2.0 preview preparation script is missing." }

  & $PreparePreview
  if ($LASTEXITCODE -ne 0) { throw "Protocol 2.0 preview preparation failed." }

  Write-BootstrapScript -ScriptPath $ArmScriptPath -HostPath $HostPath -SentinelPath $ArmSentinelPath -Arm $true
  Write-BootstrapScript -ScriptPath $DisarmScriptPath -HostPath $HostPath -SentinelPath $ArmSentinelPath -Arm $false
  $ArmAttempted = $true
  Invoke-ExistingAeScript -AfterFx $AfterFx -ScriptPath $ArmScriptPath
  Wait-ForArmSentinel -Seconds 20

  $AfterArm = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $TargetPid })
  if ($AfterArm.Count -ne 1) { throw "Warm host bootstrap changed or lost the target After Effects process." }

  Push-Location $RepoRoot
  try {
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
      npm install
      if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    }
    npm run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

    $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m3-marker-motion-p3-p4-cli.js"
    if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled marker-motion P3/P4 CLI is missing: $Cli" }

    Write-Host "EditFlow 2.0 M3 marker-motion P3/P4 proof using the existing After Effects process."
    Write-Host ("Warm AE PID: " + $TargetPid)
    Write-Host "P3: viewer-visible motion-blur/shutter and retimed-footage frame-blending render evidence plus exact structural readback."
    Write-Host "P4: induced post-verification failure through the real protocol-2.0 path, exact structural rollback, fingerprint restoration, and recovery render."

    $NodeArgs = @($Cli, "--config", $ConfigPath, "--result", $ResultPath, "--timeout-ms", ($TimeoutSeconds * 1000))
    $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $NodeProcess.HasExited -and (Get-Date) -lt $Deadline) {
      Start-Sleep -Milliseconds 250
      $NodeProcess.Refresh()
    }
    if (-not $NodeProcess.HasExited) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "Marker-motion P3/P4 Node proof exceeded its declared timeout."
    }
    if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "Marker-motion P3/P4 CLI exited without result.json." }

    $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
    if ($Result.ok -ne $true -or [string]$Result.classification -ne "PASS") {
      $FailureMessage = if ($Result.message) { [string]$Result.message } else { "Marker-motion P3/P4 proof failed." }
    } elseif ($Result.cleanupComplete -ne $true -or -not $Result.proofLevels.P3_visual_proof -or -not $Result.proofLevels.P4_failure_injection_rollback) {
      throw "Marker-motion P3/P4 result overclaimed PASS without cleanup/P3/P4 acceptance."
    } elseif (-not $Result.checks.p4_fingerprint_restored -or -not $Result.checks.p4_structural_state_restored -or -not $Result.checks.p4_recovery_visual_artifact) {
      throw "Marker-motion P4 result is missing rollback/fingerprint/recovery proof."
    } else {
      $ProofSucceeded = $true
    }
  } finally {
    Pop-Location
  }
} catch {
  $FailureMessage = $_.Exception.Message
  Write-InfrastructureFailureIfMissing -Message $FailureMessage
} finally {
  if ($ArmAttempted -and (Test-Path $DisarmScriptPath -PathType Leaf)) {
    try { Invoke-ExistingAeScript -AfterFx $AfterFx -ScriptPath $DisarmScriptPath } catch { Write-Warning ("Unable to disarm P4 proof flag: " + $_.Exception.Message) }
  }

  $WarmAfter = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $TargetPid })
  if ($WarmAfter.Count -ne 1) {
    $ProofSucceeded = $false
    $FailureMessage = "The marker-motion proof did not preserve the original warm After Effects PID."
    Write-InfrastructureFailureIfMissing -Message $FailureMessage
  }

  if (Test-Path $ResultPath -PathType Leaf) {
    try {
      $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
      $Result | Add-Member -NotePropertyName warmProcess -NotePropertyValue ([pscustomobject]@{ pidBefore = $TargetPid; pidAfter = if ($WarmAfter.Count -eq 1) { [int]$WarmAfter[0].Id } else { $null }; reused = $true; restarted = $false; hostReloadedInProcess = (Test-Path $ArmSentinelPath -PathType Leaf) }) -Force
      if (-not $ProofSucceeded -and $FailureMessage -and $Result.ok -eq $true) {
        $Result.ok = $false
        $Result.status = "FAILURE"
        $Result.classification = "INFRASTRUCTURE_FAILURE"
        $Result.message = $FailureMessage
      }
      [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 20) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    } catch { Write-Warning ("Unable to append warm-process evidence: " + $_.Exception.Message) }
  }
}

if (-not $ProofSucceeded) {
  if ($FailureMessage) { Write-Error $FailureMessage }
  exit 1
}

Write-Host "M3 marker-motion P3/P4 proof passed and the existing After Effects process remains alive."
Write-Host ("Result artifact: " + $ResultPath)
exit 0
