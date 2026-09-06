param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$ResultPath = Join-Path $ArtifactDir "final-baseline-result.json"
$CleanupGraceSeconds = 30

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running for the final M2 baseline coverage proof." }

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
      throw "The final M2 baseline proof target is not the already-running After Effects executable: $ResolvedExplicit"
    }
    return $ResolvedExplicit
  }

  if ($RunningPaths.Count -ne 1) {
    throw "The final M2 baseline proof requires exactly one resolvable After Effects executable when -AfterFxPath is omitted."
  }
  return $RunningPaths[0]
}

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run install-editflow-cep.ps1 first."
}

$AfterFx = Resolve-RunningAfterFx $AfterFxPath
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath -PathType Leaf) { Remove-Item $ResultPath -Force }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\cep-baseline-coverage-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled final baseline coverage CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M2 final baseline coverage proof through authenticated CEP transport"
  Write-Host ("Running After Effects: " + $AfterFx)
  Write-Host "This proof covers positive composition settings, anchor point, layer/effect removal, keyframe create-update-delete, and real media import with fixed Undo cleanup."

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + $CleanupGraceSeconds)
  $ResultSeenAt = $null

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
        Write-Warning "Final baseline proof cleanup is complete but Node did not exit; terminating only the completed acceptance runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M2 final baseline coverage exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M2 final baseline coverage exited without final-baseline-result.json (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M2 final baseline proof did not restore the project after its bounded writes."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M2 final baseline real-AE proof failed."
  }

  Write-Host ("M2 final baseline proof status: " + $Result.status)
  Write-Host ("Final baseline result artifact: " + $ResultPath)
  Write-Host ("Generated media artifact: " + $Result.mediaArtifact)
} finally {
  Pop-Location
}
