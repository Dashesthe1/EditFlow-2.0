param(
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-cep-smoke"
$ResultPath = Join-Path $ArtifactDir "result.json"

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
  throw "EditFlow CEP runtime config is missing. Run .\scripts\windows\install-editflow-cep.ps1 first."
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
if (Test-Path $ResultPath) { Remove-Item $ResultPath -Force }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  npm run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\cep-smoke-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled CEP smoke CLI not found: $Cli" }

  Write-Host "Starting read-only EditFlow CEP transport smoke."
  Write-Host "After Effects must be running with Window > Extensions (Legacy) > EditFlow 2.0 Bridge open."

  $NodeArgs = @(
    $Cli,
    "--config", $ConfigPath,
    "--result", $ResultPath,
    "--timeout-ms", ($TimeoutSeconds * 1000)
  )
  $NodeProcess = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  $HardDeadline = (Get-Date).AddSeconds($TimeoutSeconds + 45)
  $ResultSeenAt = $null
  $ForcedAfterResult = $false

  while (-not $NodeProcess.HasExited) {
    if (Test-Path $ResultPath -PathType Leaf) {
      if ($null -eq $ResultSeenAt) {
        $ResultSeenAt = Get-Date
      } elseif (((Get-Date) - $ResultSeenAt).TotalSeconds -ge 2) {
        Write-Warning "CEP smoke proof artifact is complete but the Node process did not exit; terminating the completed smoke runtime."
        Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
        $NodeProcess.WaitForExit()
        $ForcedAfterResult = $true
        break
      }
    }

    if ((Get-Date) -ge $HardDeadline) {
      Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
      $NodeProcess.WaitForExit()
      throw "M2 CEP transport smoke exceeded its hard runtime without producing a proof artifact."
    }

    Start-Sleep -Milliseconds 200
    $NodeProcess.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) {
    $ExitCode = $NodeProcess.ExitCode
    throw "M2 CEP transport smoke exited without a proof artifact (exit code $ExitCode)."
  }

  $ResultJson = Get-Content $ResultPath -Raw
  $Result = $ResultJson | ConvertFrom-Json
  if (-not $Result.ok) {
    $ResultJson | Write-Host
    throw "M2 CEP transport smoke failed."
  }

  Write-Host ("M2 CEP transport status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if ($ForcedAfterResult) {
    Write-Host "Smoke proof completed successfully; the wrapper terminated a stuck post-proof Node shutdown."
  }
} finally {
  Pop-Location
}
