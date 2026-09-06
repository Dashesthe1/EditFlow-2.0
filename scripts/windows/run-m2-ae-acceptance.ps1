param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RenderPath = Join-Path $ArtifactDir "m2-proof.avi"
$RenderLifecyclePath = $RenderPath + ".editflow-render.json"
$CleanupGraceSeconds = 180

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) {
    throw "Adobe After Effects is not running. Open the exact After Effects version/project you are willing to use for the bounded temporary proof, then rerun. The proof does not save or replace the project."
  }

  $RunningPaths = @()
  foreach ($Process in $Running) {
    $ProcessPath = $null
    try { $ProcessPath = $Process.Path } catch { $ProcessPath = $null }
    if ($ProcessPath -and (Test-Path $ProcessPath -PathType Leaf)) {
      $ResolvedPath = (Resolve-Path $ProcessPath).Path
      if ($RunningPaths -notcontains $ResolvedPath) { $RunningPaths += $ResolvedPath }
    }
  }

  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found at explicit path: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
    if ($RunningPaths -notcontains $ResolvedExplicit) {
      throw "The explicit AfterFxPath is not an already running After Effects executable: $ResolvedExplicit. Open that exact AE version first, or omit -AfterFxPath when only one AE version is running."
    }
    return $ResolvedExplicit
  }

  if ($RunningPaths.Count -eq 0) {
    throw "After Effects is running, but its executable path could not be resolved. Rerun with -AfterFxPath pointing to the already running AfterFX.exe."
  }

  if ($RunningPaths.Count -gt 1) {
    $List = $RunningPaths -join "`n - "
    throw "Multiple After Effects installations are running. Close all but the intended target, or rerun with -AfterFxPath matching one of these already running executables:`n - $List"
  }

  return $RunningPaths[0]
}

function Write-RenderLifecycleEvidence {
  if (-not (Test-Path $RenderLifecyclePath -PathType Leaf)) {
    Write-Warning "Render lifecycle marker was not found: $RenderLifecyclePath"
    return
  }

  Write-Host "Render lifecycle marker:"
  try {
    Get-Content $RenderLifecyclePath -Raw | Write-Host
  } catch {
    Write-Warning ("Unable to read render lifecycle marker: " + $_.Exception.Message)
  }
}

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
}

$AfterFx = Resolve-RunningAfterFx $AfterFxPath
$VersionInfo = (Get-Item $AfterFx).VersionInfo
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }
if (Test-Path $RenderPath) { Remove-Item $RenderPath -Force }
if (Test-Path $RenderLifecyclePath) { Remove-Item $RenderLifecyclePath -Force }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\cep-write-acceptance-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled CEP write acceptance CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M2 real-AE proof through authenticated CEP transport"
  Write-Host "Running After Effects: $AfterFx"
  if ($VersionInfo.ProductVersion) { Write-Host ("Running AE version: " + $VersionInfo.ProductVersion) }
  Write-Host "Keep Window > Extensions > EditFlow 2.0 Bridge open during this proof."
  Write-Host "The proof performs bounded temporary writes, renders one 1-second artifact, then removes its temporary project items."

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + $CleanupGraceSeconds)
  $ResultSeenAt = $null
  $ForcedAfterResult = $false

  while (-not $NodeProcess.HasExited) {
    $CleanupComplete = $false
    if (Test-Path $ResultPath -PathType Leaf) {
      try {
        $CandidateResult = Get-Content $ResultPath -Raw | ConvertFrom-Json
        $CleanupComplete = $CandidateResult.cleanupComplete -eq $true
      } catch {
        $CleanupComplete = $false
      }
    }

    if ($CleanupComplete) {
      if ($null -eq $ResultSeenAt) {
        $ResultSeenAt = Get-Date
      } elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "M2 proof and cleanup are complete but the Node process did not exit; terminating the completed acceptance runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      Write-RenderLifecycleEvidence
      throw "M2 CEP real-AE acceptance exceeded its hard runtime before cleanup completion. Close/reopen the blank test project before another proof attempt."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    $ExitCode = $NodeProcess.ExitCode
    Write-RenderLifecycleEvidence
    throw "M2 CEP real-AE acceptance exited without a proof artifact (exit code $ExitCode)."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    Write-RenderLifecycleEvidence
    throw "M2 acceptance produced a result before cleanup completion; refusing to treat it as final proof evidence."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    Write-RenderLifecycleEvidence
    throw "M2 bounded real-AE proof did not pass all implemented checks."
  }

  Write-Host ("M2 proof status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($Result.renderArtifact) { Write-Host ("Render artifact: " + $Result.renderArtifact) }
  if ($ForcedAfterResult) {
    Write-Host "Proof and cleanup completed successfully; the wrapper terminated only the stuck post-proof Node shutdown."
  }

  if (-not $Result.proofLevels.P4_failure_injection_rollback -or -not $Result.proofLevels.P5_save_reopen_reconnect_transfer) {
    Write-Warning "Bounded CEP host proof passed, but M2 remains open: P4 failure-injection rollback and P5 save/reopen/reconnect are intentionally not claimed by this script."
  }
} finally {
  Pop-Location
}
