param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [Parameter(Mandatory = $true)]
  [string]$AcceptedP1P2Path,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-ease-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p3-p4"
$BaselinePath = Join-Path $ProofArtifactDir "cleanup-baseline.json"
$ResultPath = Join-Path $ProofArtifactDir "result.json"
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
    "EditFlow M3 temporal-ease P3/P4 CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-RetryablePanelRegistrationFailure {
  if (Test-Path $ResultPath -PathType Leaf) { return $false }
  if (-not (Test-Path $BaselinePath -PathType Leaf)) { return $false }
  try {
    $BaselineFailure = Get-Content $BaselinePath -Raw | ConvertFrom-Json
    return $BaselineFailure.status -eq "FAILURE" `
      -and [string]$BaselineFailure.error -match "CEP_PANEL_REGISTRATION_TIMEOUT"
  } catch {
    return $false
  }
}

function Retain-PanelRetryEvidence {
  param([int]$Attempt)
  $Destination = Join-Path $ProofArtifactDir ("panel-registration-retry-attempt-" + $Attempt)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($Name in @("cleanup-baseline.json", "panel-bootstrap.log", "startup-diagnostics.log")) {
    $Source = Join-Path $ProofArtifactDir $Name
    if (Test-Path $Source -PathType Leaf) { Copy-Item -LiteralPath $Source -Destination (Join-Path $Destination $Name) -Force }
  }
  Copy-CepFailureDiagnostics -Destination $Destination
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath" }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted temporal-ease P1/P2 result artifact is missing: $AcceptedP1P2Path" }
$AcceptedP1P2Path = (Resolve-Path $AcceptedP1P2Path).Path

# A control-branch or manual proof dispatch can bypass PR synchronization, so prove
# the exact checkout is healthy before installing CEP files or launching AE.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before temporal-ease P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; temporal-ease P3/P4 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  'The M3 mask P3/P4 acceptance runner is missing',
  '& $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) { throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token" }
}

$Ease = $Template
$Ease = $Ease.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-temporal-ease-p3-p4.ps1')
$Ease = $Ease.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-temporal-ease-p3-p4')
$Ease = $Ease.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF')
$Ease = $Ease.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.8 registration')
$Ease = $Ease.Replace('M3 mask P3/P4', 'M3 temporal-ease P3/P4')
$Ease = $Ease.Replace('M3 mask/Bezier', 'M3 temporal-ease')
$Ease = $Ease.Replace('isolated M3 AE proof', 'isolated M3 temporal-ease AE proof')
$Ease = $Ease.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 temporal-ease P3/P4 acceptance runner is missing')
$Ease = $Ease.Replace('& $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds', '& $Acceptance -AfterFxPath $AfterFxPath -AcceptedP1P2Path $AcceptedP1P2Path -TimeoutSeconds $TimeoutSeconds')

# Thread the accepted P1/P2 artifact path into the generated proven launcher without
# changing any AE cold-start, window-readiness, panel-bootstrap, or cleanup behavior.
$ParamNeedle = '[string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",'
if (-not $Ease.Contains($ParamNeedle)) { throw "Accepted self-hosted template parameter block drifted before temporal-ease dependency injection." }
$ParamReplacement = $ParamNeedle + [Environment]::NewLine + '  [Parameter(Mandatory = $true)]' + [Environment]::NewLine + '  [string]$AcceptedP1P2Path,'
$Ease = $Ease.Replace($ParamNeedle, $ParamReplacement)
[System.IO.File]::WriteAllText($TempPath, $Ease, (New-Object System.Text.UTF8Encoding($false)))

# CEP 12 LogLevel is process-start scoped. Arm it before the generated template
# launches the isolated AE process, preserve the prior registry value, and retain
# recent CEP logs only on failure. One exact zero-AE retry is allowed only for a
# pre-result CEP panel registration timeout, matching accepted M3 proof behavior.
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
  if ($EffectiveLogLevel -ne "6") { throw "Unable to arm CEP 12 verbose logging for temporal-ease P3/P4 proof." }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"

  $Completed = $false
  for ($Attempt = 1; $Attempt -le $MaxPanelRegistrationAttempts; $Attempt++) {
    $AttemptError = $null
    try {
      & $TempPath -AfterFxPath $AfterFxPath -AcceptedP1P2Path $AcceptedP1P2Path -TimeoutSeconds $TimeoutSeconds
      if ($LASTEXITCODE -ne 0) { throw "Temporal-ease P3/P4 generated self-hosted runner exited with code $LASTEXITCODE." }
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
        throw "Temporal-ease P3/P4 panel-registration retry refused because the failed isolated attempt did not return to a zero-After-Effects baseline."
      }
      Retain-PanelRetryEvidence -Attempt $Attempt
      Write-Host ("Authenticated CEP panel registration timed out before any proof result on attempt " + $Attempt + "; retrying one fresh isolated AE launch from the verified zero-process baseline.")
      Start-Sleep -Seconds 2
      continue
    }

    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    throw $AttemptError
  }

  if (-not $Completed) { throw "Temporal-ease P3/P4 self-hosted runner exhausted its bounded panel-registration attempts." }
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
