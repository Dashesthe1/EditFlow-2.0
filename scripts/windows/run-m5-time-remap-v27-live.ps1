param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 45
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) {
  $env:EDITFLOW_PROOF_ARTIFACT_DIR
} else {
  Join-Path $RepoRoot "proofs\artifacts\m5-time-remap-v27-live"
}
$ProofSource = Join-Path $RepoRoot "scripts\windows\m5-time-remap-v27-live-proof.jsx"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-time-remap-v27-proof.jsx"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Protocol 2.7 Time Remap proof did not complete."
$HostResult = $null
$MutationStarted = $false
$CleanupComplete = $false
$BeforePids = @()
$AfterPids = @()

try {
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) {
    throw "AfterFX.exe not found: $AfterFxPath"
  }
  if (-not (Test-Path $ProofSource -PathType Leaf)) {
    throw "Time Remap proof source missing: $ProofSource"
  }

  $BeforePids = @(
    Get-Process AfterFX -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id
  )
  if ($BeforePids.Count -lt 1) {
    throw "Warm proof requires an already-running After Effects process."
  }

  Remove-Item $HostResultPath, $ResultPath, $RunScriptPath -Force -ErrorAction SilentlyContinue
  $Template = [System.IO.File]::ReadAllText($ProofSource)
  $ForJs = {
    param([string]$Path)
    $Path.Replace('\', '/').Replace('"', '\"')
  }
  $Generated = $Template.Replace("__EDITFLOW_REPO_ROOT__", (& $ForJs $RepoRoot))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "PRODUCT_FAILURE"
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $RunScriptPath) -PassThru)

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) {
    throw "Timed out waiting for protocol 2.7 Time Remap host result."
  }

  $ReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReadDeadline -and $null -eq $HostResult) {
    try {
      $HostResult = Get-Content $HostResultPath -Raw | ConvertFrom-Json
    } catch {
      $HostResult = $null
    }
    if ($null -eq $HostResult) {
      Start-Sleep -Milliseconds 50
    }
  }
  if ($null -eq $HostResult) {
    throw "Protocol 2.7 Time Remap host result was not valid JSON."
  }

  $MutationStarted = [bool]$HostResult.mutationStarted
  $CleanupComplete = [bool]$HostResult.cleanupComplete
  $AfterPids = @(
    Get-Process AfterFX -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id
  )
  $OriginalProcessSurvived = @($BeforePids | Where-Object { $AfterPids -contains $_ }).Count -gt 0

  if ($HostResult.ok -eq $true -and $CleanupComplete -and $OriginalProcessSurvived) {
    $Classification = "PASS"
    $Message = "Protocol 2.7 native Time Remap enable/readback, idempotency, stale-revision refusal, induced rollback, cleanup, and warm-AE PID survival passed."
  } else {
    if (-not $OriginalProcessSurvived) {
      $Message = "The original After Effects process did not survive the warm Time Remap proof."
    } elseif ($HostResult.error) {
      $Message = [string]$HostResult.error
    } else {
      $Message = "Protocol 2.7 Time Remap host checks failed."
    }
  }
} catch {
  $Message = $_.Exception.Message
  $AfterPids = @(
    Get-Process AfterFX -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id
  )
} finally {
  $Result = [ordered]@{
    proofId = "M5_TIME_REMAP_V27_LIVE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    mutationStarted = $MutationStarted
    cleanupComplete = $CleanupComplete
    beforeAfterFxPids = $BeforePids
    afterAfterFxPids = $AfterPids
    message = $Message
    hostResult = $HostResult
  }
  [System.IO.File]::WriteAllText(
    $ResultPath,
    (($Result | ConvertTo-Json -Depth 64) + [Environment]::NewLine),
    $Utf8NoBom
  )
}

if ($Classification -ne "PASS") {
  Write-Error $Message
  exit 1
}
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
