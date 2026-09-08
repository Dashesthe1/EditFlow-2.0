param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-ease-p5-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p5-transfer"
$ResultPath = Join-Path $ProofArtifactDir "result.json"
$SavedProjectPath = Join-Path $ProofArtifactDir "m3-temporal-ease-p5-transfer.aep"
$AcceptedP1P4 = Join-Path $RepoRoot "proofs\diagnostics\m3-temporal-ease-p1-p4-acceptance.json"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null
$MaxPanelRegistrationAttempts = 2

function Copy-CepFailureDiagnostics {
  param([string]$Destination)
  if (-not $env:TEMP -or -not (Test-Path $env:TEMP -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $Cutoff = (Get-Date).AddMinutes(-20)
  $Patterns = @("CEP12-AEFT*.log", "CEPHtmlEngine12-AEFT-*.log", "CEPHTMLEngine12-AEFT-*.log")
  $Seen = @{}
  $Copied = @()
  foreach ($Pattern in $Patterns) {
    $Candidates = @(Get-ChildItem -Path $env:TEMP -Filter $Pattern -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $Cutoff })
    foreach ($Candidate in $Candidates) {
      if ($Seen.ContainsKey($Candidate.FullName)) { continue }
      $Seen[$Candidate.FullName] = $true
      try {
        Copy-Item -LiteralPath $Candidate.FullName -Destination (Join-Path $Destination $Candidate.Name) -Force -ErrorAction Stop
        $Copied += $Candidate.Name
      } catch {
        Write-Warning ("Unable to retain CEP diagnostic log {0}: {1}" -f $Candidate.FullName, $_.Exception.Message)
      }
    }
  }
  $Manifest = @(
    "EditFlow M3 temporal-ease P5 CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-RetryablePanelRegistrationFailure {
  if (-not (Test-Path $ResultPath -PathType Leaf)) { return $false }
  try {
    $Failure = Get-Content $ResultPath -Raw | ConvertFrom-Json
    $Responses = @($Failure.responses)
    return $Failure.proofId -eq "M3_TEMPORAL_EASE_P5_REAL_AE" `
      -and $Failure.status -eq "FAILURE" `
      -and $Failure.ok -eq $false `
      -and [string]$Failure.failureError -match "CEP_PANEL_REGISTRATION_TIMEOUT" `
      -and $Failure.checks.accepted_p1_p4_verified -eq $true `
      -and $Failure.checks.proof_scripts_present -eq $true `
      -and $Failure.checks.afterfx_present -eq $true `
      -and $null -eq $Failure.panel.initialSession `
      -and $null -eq $Failure.panel.reconnectedSession `
      -and $null -eq $Failure.baseline.projectFingerprint `
      -and $null -eq $Failure.saved.projectFingerprint `
      -and $Responses.Count -eq 0 `
      -and -not (Test-Path $SavedProjectPath -PathType Leaf)
  } catch {
    return $false
  }
}

function Retain-PanelRetryEvidence {
  param([int]$Attempt)
  $Destination = Join-Path $ProofArtifactDir ("panel-registration-retry-attempt-" + $Attempt)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($Name in @("result.json", "cleanup-result.json", "panel-bootstrap.log", "startup-diagnostics.log")) {
    $Source = Join-Path $ProofArtifactDir $Name
    if (Test-Path $Source -PathType Leaf) {
      Copy-Item -LiteralPath $Source -Destination (Join-Path $Destination $Name) -Force
    }
  }
  Copy-CepFailureDiagnostics -Destination $Destination
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}
if (-not (Test-Path $AcceptedP1P4 -PathType Leaf)) {
  throw "Temporal-ease P5 is intentionally blocked until retained P1-P4 acceptance exists: $AcceptedP1P4"
}

# A control-branch push can bypass PR synchronization, so validate the exact
# checkout before installing CEP files or launching After Effects.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before temporal-ease P5 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; temporal-ease P5 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  'The M3 mask P3/P4 acceptance runner is missing'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 mask P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

# Reuse the already accepted low-level AE launch lifecycle. Only the capability
# wrapper, artifact namespace, proof environment, and expected protocol change.
$Temporal = $Template
$Temporal = $Temporal.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-temporal-ease-p5.ps1')
$Temporal = $Temporal.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-temporal-ease-p5-transfer')
$Temporal = $Temporal.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF')
$Temporal = $Temporal.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.8 registration')
$Temporal = $Temporal.Replace('M3 mask P3/P4', 'M3 temporal-ease P5')
$Temporal = $Temporal.Replace('M3 mask/Bezier', 'M3 temporal-ease')
$Temporal = $Temporal.Replace('isolated M3 AE proof', 'isolated M3 temporal-ease AE proof')
$Temporal = $Temporal.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 temporal-ease P5 acceptance runner is missing')
$Temporal = $Temporal.Replace('P4_PROOF_INJECTION_ARMED', 'P5_TRANSFER_PROOF_ARMED')
$Temporal = $Temporal.Replace('P4_PROOF_INJECTION_DISARMED', 'P5_TRANSFER_PROOF_DISARMED')
[System.IO.File]::WriteAllText($TempPath, $Temporal, (New-Object System.Text.UTF8Encoding($false)))

$NearbyP5EnvNames = @(
  "EDITFLOW_M3_MASK_P5_PROOF",
  "EDITFLOW_M3_COMPOSITE_P5_PROOF",
  "EDITFLOW_M3_PARENTING_P5_PROOF",
  "EDITFLOW_M3_NULL_RIG_P5_PROOF",
  "EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF",
  "EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF"
)
$OriginalNearbyP5Env = @{}
foreach ($Name in $NearbyP5EnvNames) {
  $OriginalNearbyP5Env[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
  Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
}

try {
  New-Item -Path $CsxsKey -Force | Out-Null
  try {
    $ExistingCsxs = Get-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction Stop
    $OriginalLogLevelPresent = $true
    $OriginalLogLevel = [string]$ExistingCsxs.LogLevel
  } catch {
    $OriginalLogLevelPresent = $false
  }
  New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value "6" -Force | Out-Null
  $EffectiveLogLevel = [string](Get-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction Stop).LogLevel
  if ($EffectiveLogLevel -ne "6") { throw "Unable to arm CEP 12 verbose logging for temporal-ease P5 proof." }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"

  $Completed = $false
  for ($Attempt = 1; $Attempt -le $MaxPanelRegistrationAttempts; $Attempt++) {
    $AttemptError = $null
    try {
      & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
      if ($LASTEXITCODE -ne 0) {
        throw "Temporal-ease P5 generated self-hosted runner exited with code $LASTEXITCODE."
      }
      $Completed = $true
      break
    } catch {
      $AttemptError = $_
    }

    $RetryableRegistrationFailure = Test-RetryablePanelRegistrationFailure
    if ($Attempt -lt $MaxPanelRegistrationAttempts -and $RetryableRegistrationFailure) {
      $RemainingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($RemainingAfterFx.Count -ne 0) {
        Retain-PanelRetryEvidence -Attempt $Attempt
        throw "Temporal-ease P5 panel-registration retry refused because the failed isolated attempt did not return to a zero-After-Effects baseline."
      }
      Retain-PanelRetryEvidence -Attempt $Attempt
      Write-Host ("Authenticated CEP panel registration timed out before any P5 mutation or saved artifact on attempt " + $Attempt + "; retrying one fresh isolated AE launch from the verified zero-process baseline.")
      Start-Sleep -Seconds 2
      continue
    }

    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    throw $AttemptError
  }

  if (-not $Completed) {
    throw "Temporal-ease P5 self-hosted runner exhausted its bounded panel-registration attempts."
  }
} catch {
  Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
  throw
} finally {
  if ($OriginalLogLevelPresent) {
    New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value $OriginalLogLevel -Force -ErrorAction SilentlyContinue | Out-Null
  } else {
    Remove-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction SilentlyContinue
  }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
  foreach ($Name in $NearbyP5EnvNames) {
    $OriginalValue = $OriginalNearbyP5Env[$Name]
    if ($null -ne $OriginalValue) { [Environment]::SetEnvironmentVariable($Name, [string]$OriginalValue, "Process") }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
  }
}
