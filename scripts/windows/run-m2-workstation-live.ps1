param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [string]$ExpectedProductVersionPrefix = "25.6.6"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LiveArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-workstation-live"
New-Item -ItemType Directory -Force -Path $LiveArtifactDir | Out-Null

function Write-LiveStatus {
  param([string]$Stage, [string]$Message)
  $status = [ordered]@{
    stage = $Stage
    message = $Message
    at = (Get-Date).ToUniversalTime().ToString("o")
    github_sha = $env:GITHUB_SHA
    github_ref = $env:GITHUB_REF
  }
  $status | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $LiveArtifactDir "status.json") -Encoding utf8
  Write-Host ("[M2 workstation] " + $Stage + ": " + $Message)
}

if (-not (Test-Path $AfterFxPath -PathType Leaf)) {
  throw "Expected After Effects executable is missing: $AfterFxPath"
}

$ResolvedAfterFx = (Resolve-Path $AfterFxPath).Path
$VersionInfo = (Get-Item $ResolvedAfterFx).VersionInfo
if (-not $VersionInfo.ProductVersion -or -not $VersionInfo.ProductVersion.StartsWith($ExpectedProductVersionPrefix)) {
  throw "M2 workstation is pinned to After Effects $ExpectedProductVersionPrefix; found '$($VersionInfo.ProductVersion)' at $ResolvedAfterFx"
}

$Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
$OtherAe = @()
$TargetRunning = $false
foreach ($Process in $Running) {
  $ProcessPath = $null
  try { $ProcessPath = $Process.Path } catch { $ProcessPath = $null }
  if (-not $ProcessPath) { continue }
  $ResolvedProcessPath = $ProcessPath
  try { $ResolvedProcessPath = (Resolve-Path $ProcessPath).Path } catch {}
  if ($ResolvedProcessPath -eq $ResolvedAfterFx) {
    $TargetRunning = $true
  } else {
    $OtherAe += $ResolvedProcessPath
  }
}
if ($OtherAe.Count -gt 0) {
  throw "A different After Effects installation is running. Autonomous M2 refuses to close or target it: $($OtherAe -join '; ')"
}

Write-LiveStatus "INSTALL" "Installing current branch CEP/host files with token preservation."
& (Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1")
if ($LASTEXITCODE -ne 0) { throw "CEP installer failed with exit code $LASTEXITCODE" }

if (-not $TargetRunning) {
  Write-LiveStatus "START_AE" "Starting pinned After Effects 2025 host."
  Start-Process -FilePath $ResolvedAfterFx | Out-Null
  $StartDeadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    $TargetRunning = $false
    foreach ($Process in @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)) {
      try {
        if ((Resolve-Path $Process.Path).Path -eq $ResolvedAfterFx) { $TargetRunning = $true; break }
      } catch {}
    }
  } while (-not $TargetRunning -and (Get-Date) -lt $StartDeadline)
  if (-not $TargetRunning) { throw "Pinned After Effects process did not appear within 90 seconds." }
}

Write-LiveStatus "SMOKE" "Running read-only CEP transport smoke before any bounded write proof."
& (Join-Path $RepoRoot "scripts\windows\run-m2-cep-smoke.ps1") -TimeoutSeconds 90
if ($LASTEXITCODE -ne 0) { throw "M2 CEP smoke failed with exit code $LASTEXITCODE" }

Write-LiveStatus "ACCEPTANCE" "Running bounded real-AE acceptance through the authenticated CEP transport."
& (Join-Path $RepoRoot "scripts\windows\run-m2-ae-acceptance.ps1") -AfterFxPath $ResolvedAfterFx -TimeoutSeconds 180
if ($LASTEXITCODE -ne 0) { throw "M2 real-AE acceptance failed with exit code $LASTEXITCODE" }

Write-LiveStatus "PASS" "Read-only smoke and bounded real-AE acceptance both passed."
