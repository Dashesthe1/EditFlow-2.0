param(
  [string]$AfterFxPath = "",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-real-host"
$ResultPath = Join-Path $ArtifactDir "media-import-result.json"
$SourcePath = Join-Path $ArtifactDir "m2-media-import-proof.wav"
$CleanupGraceSeconds = 30

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)

  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running for the media import acceptance proof." }

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
      throw "The media import proof target is not the already-running After Effects executable: $ResolvedExplicit"
    }
    return $ResolvedExplicit
  }

  if ($RunningPaths.Count -ne 1) {
    throw "The media import proof requires exactly one resolvable After Effects executable when -AfterFxPath is omitted."
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
if (Test-Path $SourcePath -PathType Leaf) { Remove-Item $SourcePath -Force }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\cep-media-import-acceptance-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled media import acceptance CLI not found: $Cli" }

  Write-Host "EditFlow 2.0 M2 real-AE media import proof through authenticated CEP transport"
  Write-Host ("Running After Effects: " + $AfterFx)
  Write-Host "The proof creates one silent WAV under the bounded artifact root, imports it, verifies structural identity, then removes it with fixed Undo."

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
        Write-Warning "Media import proof cleanup is complete but Node did not exit; terminating only the completed acceptance runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M2 media import acceptance exceeded its hard runtime before cleanup completion."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    throw "M2 media import acceptance exited without media-import-result.json (exit code $($NodeProcess.ExitCode))."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if ($Result.cleanupComplete -ne $true) {
    $ResultJson | Write-Host
    throw "M2 media import proof did not restore the project after import."
  }
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M2 media import real-AE proof failed."
  }

  Write-Host ("M2 media import proof status: " + $Result.status)
  Write-Host ("Media import result artifact: " + $ResultPath)
  Write-Host ("Media source artifact: " + $Result.sourceArtifact)
} finally {
  Pop-Location
}
