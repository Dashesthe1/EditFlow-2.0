param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$StartedAt = (Get-Date).ToUniversalTime().ToString("o")
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ResultPath = Join-Path $ArtifactDir "result.json"

function Write-SmokeResult {
  param(
    [Parameter(Mandatory = $true)][string]$Classification,
    [Parameter(Mandatory = $true)][string]$Message,
    [AllowNull()][int]$AeProcessId,
    [bool]$StablePid
  )
  $Result = [ordered]@{
    proofId = if ($env:EDITFLOW_PROOF_ID) { $env:EDITFLOW_PROOF_ID } else { "infra.ae_warm_session.smoke" }
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    lifecycle = $env:EDITFLOW_AE_LIFECYCLE
    mutationStarted = $false
    cleanupComplete = $true
    aePid = $AeProcessId
    stablePid = $StablePid
    startedAt = $StartedAt
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if ($env:EDITFLOW_AE_WARM_SESSION -ne "1") { throw "Warm-session contract was not supplied by the orchestrator." }
  if ($env:EDITFLOW_AE_LIFECYCLE -notin @("REUSE_AE", "REOPEN_PROJECT", "RECONNECT_BROKER", "RESTART_AE", "CLEAN_BOOT")) {
    throw "Unknown lifecycle contract: $($env:EDITFLOW_AE_LIFECYCLE)"
  }
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found at: $AfterFxPath" }
  if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }

  $ResolvedExpected = (Resolve-Path $AfterFxPath).Path
  function Find-HealthyAe {
    $Healthy = @()
    foreach ($Process in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
      try {
        $CandidatePath = (Resolve-Path $Process.Path).Path
        $Process.Refresh()
        if (
          [StringComparer]::OrdinalIgnoreCase.Equals($CandidatePath, $ResolvedExpected) -and
          $Process.Responding -and
          $Process.MainWindowHandle -ne 0 -and
          $Process.MainWindowTitle -like "Adobe After Effects*"
        ) {
          $Healthy += $Process
        }
      } catch {}
    }
    return @($Healthy)
  }

  $Initial = @(Find-HealthyAe)
  if ($Initial.Count -ne 1) { throw "Warm smoke expected exactly one healthy target AE project window; found $($Initial.Count)." }
  $InitialPid = [int]$Initial[0].Id

  # A brief stability interval proves the harness is observing an already usable
  # process rather than a transient splash/startup process. No AE mutation occurs.
  Start-Sleep -Seconds 2

  $Final = @(Find-HealthyAe)
  if ($Final.Count -ne 1) { throw "Warm smoke lost the healthy target AE project window during the stability interval." }
  $FinalPid = [int]$Final[0].Id
  if ($FinalPid -ne $InitialPid) { throw "AE PID changed during a REUSE-compatible smoke check ($InitialPid -> $FinalPid)." }

  Write-SmokeResult -Classification "PASS" -Message "Warm AE session is healthy and remained on the same process without mutation or shutdown." -AeProcessId $FinalPid -StablePid $true
  exit 0
} catch {
  Write-SmokeResult -Classification "INFRASTRUCTURE_FAILURE" -Message $_.Exception.Message -AeProcessId 0 -StablePid $false
  Write-Error $_.Exception.Message
  exit 1
}
