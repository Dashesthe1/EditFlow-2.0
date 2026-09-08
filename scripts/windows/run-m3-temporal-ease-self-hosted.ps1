param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [switch]$PreflightHostLoader
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-interpolation-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-ease-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p1-p2"
$ResultPath = Join-Path $ProofArtifactDir "result.json"
$DiagnosticBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-temporal-ease-bridge.jsx"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null
$MaxPanelRegistrationAttempts = 2

function Copy-CepFailureDiagnostics {
  param([string]$Destination)

  if (-not $env:TEMP -or -not (Test-Path $env:TEMP -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $Cutoff = (Get-Date).AddMinutes(-20)
  $Patterns = @(
    "CEP12-AEFT*.log",
    "CEPHtmlEngine12-AEFT-*.log",
    "CEPHTMLEngine12-AEFT-*.log"
  )
  $Seen = @{}
  $Copied = @()
  foreach ($Pattern in $Patterns) {
    $Candidates = @(Get-ChildItem -Path $env:TEMP -Filter $Pattern -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $Cutoff })
    foreach ($Candidate in $Candidates) {
      if ($Seen.ContainsKey($Candidate.FullName)) { continue }
      $Seen[$Candidate.FullName] = $true
      $Target = Join-Path $Destination $Candidate.Name
      try {
        Copy-Item -LiteralPath $Candidate.FullName -Destination $Target -Force -ErrorAction Stop
        $Copied += $Candidate.Name
      } catch {
        Write-Warning ("Unable to retain CEP diagnostic log {0}: {1}" -f $Candidate.FullName, $_.Exception.Message)
      }
    }
  }

  $ManifestPath = Join-Path $Destination "cep-failure-diagnostics.txt"
  $ManifestLines = @(
    "EditFlow M3 temporal-ease CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) {
    $ManifestLines += $Copied | ForEach-Object { "file=" + $_ }
  } else {
    $ManifestLines += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns."
  }
  [System.IO.File]::WriteAllLines($ManifestPath, $ManifestLines, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-RetryablePanelRegistrationFailure {
  if (-not (Test-Path $ResultPath -PathType Leaf)) { return $false }
  try {
    $Failure = Get-Content $ResultPath -Raw | ConvertFrom-Json
    $Responses = @($Failure.responses)
    $Checks = $Failure.checks
    $NoChecks = $null -eq $Checks -or @($Checks.psobject.Properties).Count -eq 0
    return $Failure.proof -eq "M3_TEMPORAL_EASE_P1_P2_REAL_AE" `
      -and $Failure.protocolVersion -eq "1.8.0" `
      -and $Failure.status -eq "FAIL" `
      -and $Failure.ok -eq $false `
      -and [string]$Failure.failureError -match "CEP_PANEL_REGISTRATION_TIMEOUT" `
      -and $null -eq $Failure.panel `
      -and $null -eq $Failure.environment `
      -and $null -eq $Failure.baseline.projectFingerprint `
      -and $null -eq $Failure.final.projectFingerprint `
      -and $Responses.Count -eq 0 `
      -and @($Failure.easeEvidence).Count -eq 0 `
      -and $NoChecks `
      -and $Failure.cleanupComplete -eq $false
  } catch {
    return $false
  }
}

function Retain-PanelRetryEvidence {
  param([int]$Attempt)
  $Destination = Join-Path $ProofArtifactDir ("panel-registration-retry-attempt-" + $Attempt)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($Name in @("result.json", "panel-bootstrap.log", "startup-diagnostics.log")) {
    $Source = Join-Path $ProofArtifactDir $Name
    if (Test-Path $Source -PathType Leaf) {
      Copy-Item -LiteralPath $Source -Destination (Join-Path $Destination $Name) -Force
    }
  }
  Copy-CepFailureDiagnostics -Destination $Destination
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted temporal-interpolation self-hosted runner template is missing: $TemplatePath"
}
if ($PreflightHostLoader -and -not (Test-Path $DiagnosticBootstrap -PathType Leaf)) {
  throw "Protocol 1.8 host-bootstrap diagnostic script is missing: $DiagnosticBootstrap"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-temporal-interpolation-p1-p2.ps1',
  'scripts\windows\open-editflow-temporal-bridge.jsx',
  'proofs\artifacts\m3-temporal-interpolation-p1-p2',
  'authenticated protocol 1.7 registration',
  'isolated M3 temporal-interpolation AE proof',
  'production-equivalent CEP host bootstrap; no direct host-loader preflight'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted temporal-interpolation self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$Ease = $Template
$Ease = $Ease.Replace('scripts\windows\run-m3-temporal-interpolation-p1-p2.ps1', 'scripts\windows\run-m3-temporal-ease-p1-p2.ps1')
$Ease = $Ease.Replace('scripts\windows\open-editflow-temporal-bridge.jsx', 'scripts\windows\open-editflow-temporal-ease-bridge.jsx')
$Ease = $Ease.Replace('proofs\artifacts\m3-temporal-interpolation-p1-p2', 'proofs\artifacts\m3-temporal-ease-p1-p2')
$Ease = $Ease.Replace('authenticated protocol 1.7 registration', 'authenticated protocol 1.8 registration')
$Ease = $Ease.Replace('temporal-interpolation P1/P2', 'temporal-ease P1/P2')
$Ease = $Ease.Replace('temporal-interpolation proof', 'temporal-ease proof')
$Ease = $Ease.Replace('temporal-interpolation AE proof', 'temporal-ease AE proof')

# Production proof remains unchanged by default: installed bridge.js must bootstrap
# current_v18 itself. -PreflightHostLoader is diagnostic-only and directly evaluates
# the fixed installed v18 loader before opening the same CEP panel command. A passing
# diagnostic run is not accepted P1/P2 evidence; it only separates host-loader health
# from client-side CEP registration behavior after a zero-mutation timeout.
[System.IO.File]::WriteAllText($TempPath, $Ease, (New-Object System.Text.UTF8Encoding($false)))
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
  if ($EffectiveLogLevel -ne "6") {
    throw "Unable to arm CEP 12 verbose logging for the isolated temporal-ease proof. Registry readback was '$EffectiveLogLevel'."
  }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"

  $Completed = $false
  for ($Attempt = 1; $Attempt -le $MaxPanelRegistrationAttempts; $Attempt++) {
    $AttemptError = $null
    try {
      if ($PreflightHostLoader) {
        Write-Host "Temporal-ease diagnostic mode: direct fixed v1.8 host-loader preflight before opening CEP; result is diagnostic-only, not acceptance evidence."
        & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds -PreflightHostLoader
      } else {
        Write-Host "Temporal-ease proof mode: production-equivalent CEP bootstrap of protocol 1.8; no direct host-loader preload."
        & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Temporal-ease generated self-hosted runner exited with code $LASTEXITCODE."
      }
      $Completed = $true
      break
    } catch {
      $AttemptError = $_
    }

    $RetryableRegistrationFailure = (-not $PreflightHostLoader) -and (Test-RetryablePanelRegistrationFailure)
    if ($Attempt -lt $MaxPanelRegistrationAttempts -and $RetryableRegistrationFailure) {
      $RemainingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($RemainingAfterFx.Count -ne 0) {
        Retain-PanelRetryEvidence -Attempt $Attempt
        throw "Temporal-ease panel-registration retry refused because the failed isolated attempt did not return to a zero-After-Effects baseline."
      }
      Retain-PanelRetryEvidence -Attempt $Attempt
      Write-Host ("Authenticated CEP panel registration timed out before any temporal-ease mutation on attempt " + $Attempt + "; retrying one fresh isolated AE launch from the verified zero-process baseline.")
      Start-Sleep -Seconds 2
      continue
    }

    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    throw $AttemptError
  }

  if (-not $Completed) {
    throw "Temporal-ease self-hosted runner exhausted its bounded panel-registration attempts."
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
}
