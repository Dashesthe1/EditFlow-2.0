param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120,
  [int]$Frames = 12
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m4-point-tracking-real-ae"
$ResultPath = Join-Path $ArtifactDir "result.json"
$Bootstrap = Join-Path $PSScriptRoot "open-editflow-m4-bridge.jsx"
$BootstrapLog = Join-Path $env:TEMP "EditFlow2-m4-panel-bootstrap.log"

if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
if ($Frames -lt 4 -or $Frames -gt 120) { throw "Frames must be between 4 and 120." }
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found at $AfterFxPath" }

$Ae = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Responding -and $_.MainWindowHandle -ne 0 })
if ($Ae.Count -ne 1) { throw "M4 warm proof requires exactly one responsive After Effects project process; found $($Ae.Count)." }
$InitialPid = [int]$Ae[0].Id

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Remove-Item $ResultPath -Force -ErrorAction SilentlyContinue
Remove-Item $BootstrapLog -Force -ErrorAction SilentlyContinue

Push-Location $RepoRoot
try {
  & (Join-Path $PSScriptRoot "install-editflow-cep.ps1") -SkipDebugMode
  if ($LASTEXITCODE -ne 0) { throw "EditFlow CEP installation failed." }
  npm.cmd run build:test-runtime
  if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }

  $Cli = Join-Path $RepoRoot ".tmp\runtime\apps\desktop-host\src\m4-tracking-real-ae-cli.js"
  if (-not (Test-Path $Cli -PathType Leaf)) { throw "Compiled M4 tracking proof CLI is missing: $Cli" }
  if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "EditFlow CEP bridge config is missing after installation." }

  $NodeArgs = @($Cli, "--config", $ConfigPath, "--result", $ResultPath, "--timeout-ms", ($TimeoutSeconds * 1000), "--frames", $Frames)
  $Node = Start-Process -FilePath "node" -ArgumentList $NodeArgs -NoNewWindow -PassThru
  Start-Sleep -Milliseconds 400
  & $AfterFxPath -r $Bootstrap

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds + 20)
  $ResultSeen = $null
  while (-not $Node.HasExited) {
    if (Test-Path $ResultPath -PathType Leaf) {
      if ($null -eq $ResultSeen) { $ResultSeen = Get-Date }
      elseif (((Get-Date) - $ResultSeen).TotalSeconds -ge 2) {
        Stop-Process -Id $Node.Id -Force -ErrorAction SilentlyContinue
        $Node.WaitForExit()
        break
      }
    }
    if ((Get-Date) -ge $Deadline) {
      Stop-Process -Id $Node.Id -Force -ErrorAction SilentlyContinue
      $Node.WaitForExit()
      throw "M4 tracking proof exceeded its hard runtime."
    }
    Start-Sleep -Milliseconds 200
    $Node.Refresh()
  }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "M4 tracking proof exited without result.json." }
  $ResultText = Get-Content $ResultPath -Raw
  $Result = $ResultText | ConvertFrom-Json
  $FinalAe = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Where-Object { $_.Responding -and $_.MainWindowHandle -ne 0 })
  if ($FinalAe.Count -ne 1 -or [int]$FinalAe[0].Id -ne $InitialPid) { throw "After Effects PID changed during REUSE_AE proof." }
  if (-not $Result.ok) { $ResultText | Write-Host; throw "M4 tracking proof did not satisfy its evidence gate." }
  Write-Host "M4 authenticated point-tracking proof: PASS"
  Write-Host ("After Effects PID preserved: " + $InitialPid)
  Write-Host ("Result artifact: " + $ResultPath)
} finally {
  Pop-Location
}
