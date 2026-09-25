param(
  [Parameter(Mandatory=$true)][string]$Finish,
  [Parameter(Mandatory=$true)][string[]]$StartVideo,
  [string[]]$StartAudio = @(),
  [Parameter(Mandatory=$true)][string]$EditTypeId,
  [string]$EditTypeTitle = "",
  [string]$SessionId = "",
  [string]$StateDir = "",
  [int]$MaxAttempts = 2,
  [double]$MinimumSimilarity = 0.95,
  [double]$StretchSimilarity = 0.99,
  [double]$ExactSceneConfidence = 0.95,
  [double]$MinimumAudioConfidence = 0.90,
  [int]$TimeoutSeconds = 180,
  [switch]$Allocate,
  [switch]$HeldOutCertification,
  [switch]$RequireRobustCertification,
  [string[]]$AppliedSkillId = @(),
  [string]$ExpectedIsolationBackend = "",
  [string]$ExpectedIsolationFallbackAfter = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
if ([string]::IsNullOrWhiteSpace($SessionId)) {
  $SessionId = "practice-live-" + (Get-Date -Format "yyyyMMdd-HHmmss")
}
$PracticeLiveRoot = Join-Path $RepoRoot "proofs\artifacts\practice-live"
$ArtifactDir = Join-Path $PracticeLiveRoot $SessionId
if ([string]::IsNullOrWhiteSpace($StateDir)) {
  if (-not [string]::IsNullOrWhiteSpace($env:EDITFLOW_PRACTICE_STATE_DIR)) {
    $StateDir = $env:EDITFLOW_PRACTICE_STATE_DIR
  } elseif (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $StateDir = Join-Path $env:LOCALAPPDATA "EditFlow2\practice-state"
  } else {
    $StateDir = Join-Path $HOME ".editflow2\practice-state"
  }
}
$StateDir = [System.IO.Path]::GetFullPath($StateDir)
$ResultPath = Join-Path $ArtifactDir "result.json"
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first."
}
if ($MaxAttempts -lt 1) { throw "MaxAttempts must be at least 1." }
if ($TimeoutSeconds -lt 30) { throw "TimeoutSeconds must be at least 30." }
if ($HeldOutCertification -and $Allocate) {
  throw "Held-out certification cannot allocate learning evidence."
}
if ($RequireRobustCertification -and -not $HeldOutCertification) {
  throw "RequireRobustCertification requires HeldOutCertification."
}
if (-not $HeldOutCertification -and @($AppliedSkillId).Count -gt 0) {
  throw "AppliedSkillId is reserved for held-out certification."
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$PanelBootstrap = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$AfterFxPath = ""
if (Test-Path $PanelBootstrap -PathType Leaf) {
  $AfterFxCandidates = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Responding -and -not [string]::IsNullOrWhiteSpace($_.Path) } catch { $false }
  })
  if ($AfterFxCandidates.Count -eq 1) {
    $AfterFxPath = $AfterFxCandidates[0].Path
  } elseif ($AfterFxCandidates.Count -eq 0) {
    $AdobeRoot = Join-Path $env:ProgramFiles "Adobe"
    $InstalledAfterFx = @(Get-ChildItem -LiteralPath $AdobeRoot -Directory -Filter "Adobe After Effects *" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "Support Files\AfterFX.exe" } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    if ($InstalledAfterFx.Count -gt 0) {
      $AfterFxPath = $InstalledAfterFx[0]
    }
  }
}
Push-Location $RepoRoot
try {
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\practice-live-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) {
    throw "Compiled Practice live CLI not found: $Cli"
  }

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--repository-root", $RepoRoot,
    "--artifact-dir", $ArtifactDir,
    "--result", $ResultPath,
    "--finish", (Resolve-Path -LiteralPath $Finish).Path,
    "--session-id", $SessionId,
    "--edit-type-id", $EditTypeId,
    "--max-attempts", [string]$MaxAttempts,
    "--minimum-similarity", [string]$MinimumSimilarity,
    "--stretch-similarity", [string]$StretchSimilarity,
    "--exact-scene-confidence", [string]$ExactSceneConfidence,
    "--minimum-audio-confidence", [string]$MinimumAudioConfidence,
    "--timeout-ms", [string]($TimeoutSeconds * 1000)
  )
  if (-not [string]::IsNullOrWhiteSpace($StateDir)) {
    $NodeArgs += @("--state-dir", $StateDir)
  }
  if (-not [string]::IsNullOrWhiteSpace($AfterFxPath)) {
    $NodeArgs += @("--afterfx-path", $AfterFxPath, "--panel-bootstrap", $PanelBootstrap)
  }
  if (-not [string]::IsNullOrWhiteSpace($EditTypeTitle)) {
    $NodeArgs += @("--edit-type-title", $EditTypeTitle)
  }
  foreach ($video in $StartVideo) {
    $NodeArgs += @("--start-video", (Resolve-Path -LiteralPath $video).Path)
  }
  foreach ($audio in $StartAudio) {
    $NodeArgs += @("--start-audio", (Resolve-Path -LiteralPath $audio).Path)
  }
  if ($Allocate) { $NodeArgs += "--allocate" }
  if ($HeldOutCertification) {
    $NodeArgs += "--held-out-certification"
    foreach ($skillId in $AppliedSkillId) {
      if (-not [string]::IsNullOrWhiteSpace($skillId)) {
        $NodeArgs += @("--applied-skill-id", $skillId.Trim())
      }
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedIsolationBackend)) {
    $NodeArgs += @("--expected-isolation-backend", $ExpectedIsolationBackend)
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedIsolationFallbackAfter)) {
    $NodeArgs += @("--expected-isolation-fallback-after", $ExpectedIsolationFallbackAfter)
  }

  Write-Host ("Starting live Practice proof session " + $SessionId)
  & node @NodeArgs
  $ExitCode = $LASTEXITCODE

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "Practice live proof produced no result artifact."
  }
  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("Practice live proof status: " + $Result.status)
  if ($Allocate -and -not $HeldOutCertification -and $null -ne $Result.learningProof) {
    Write-Host ("Learning mastery scope: " + $Result.learningProof.masteryRecord.scope)
    Write-Host ("Learning mastery proof: " + $Result.learningProof.proofRef)
    Write-Host ("Learning mastery restored: " + $Result.reloadProof.masteryRecordRestored)
  }
  if ($HeldOutCertification -and $null -ne $Result.heldOutProof) {
    Write-Host ("Held-out case passed: " + $Result.heldOutProof.heldOutCase.passed)
    Write-Host ("Held-out benchmark cases retained: " + $Result.heldOutProof.benchmark.caseCount)
    Write-Host ("Held-out skill coverage verified: " + $Result.heldOutProof.benchmark.learnedSkillCoverageVerified)
    Write-Host ("Held-out retained truth authority: " + $Result.heldOutProof.benchmark.retainedTruthSuiteAuthorityVerified)
    if ($null -ne $Result.heldOutProof.benchmark.retainedTruthSuiteEvaluatedAt) {
      Write-Host ("Held-out truth certificate evaluated at: " + $Result.heldOutProof.benchmark.retainedTruthSuiteEvaluatedAt)
    }
    Write-Host ("Held-out benchmark robust: " + $Result.heldOutProof.benchmark.robust)
  }
  if ($RequireRobustCertification -and ($null -eq $Result.heldOutProof -or $Result.heldOutProof.benchmark.robust -ne $true)) {
    throw "Practice held-out final certification is not ROBUST; retained truth, coverage, or current transfer targets still require proof."
  }
  if ($null -ne $Result.assertions) {
    Write-Host ("Persistence assertion passed: " + $Result.assertions.persistence.passed)
    $Backends = @($Result.assertions.subjectIsolation.observedBackends) -join ","
    $Fallbacks = @($Result.assertions.subjectIsolation.observedFallbacks) -join ","
    $Rejected = @($Result.assertions.subjectIsolation.observedRejectedBackends) -join ","
    $RejectionCodes = @($Result.assertions.subjectIsolation.observedRejectionCodes) -join ","
    Write-Host ("Observed isolation backends: " + $Backends)
    Write-Host ("Observed isolation fallbacks: " + $Fallbacks)
    Write-Host ("Rejected isolation backends: " + $Rejected)
    Write-Host ("Isolation rejection codes: " + $RejectionCodes)
  }
  if ($null -ne $Result.persistence) {
    Write-Host ("Shared Practice state: " + $Result.persistence.stateDir)
  }
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ExitCode -ne 0) { exit $ExitCode }
} finally {
  Pop-Location
}