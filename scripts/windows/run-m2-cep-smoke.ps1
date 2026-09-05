param(
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m2-cep-smoke"
$ResultPath = Join-Path $ArtifactDir "result.json"

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
  node $Cli --config $ConfigPath --result $ResultPath --timeout-ms ($TimeoutSeconds * 1000)
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $ResultPath) { Get-Content $ResultPath -Raw | Write-Host }
    throw "M2 CEP transport smoke failed."
  }

  $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
  Write-Host ("M2 CEP transport status: " + $Result.status)
  Write-Host ("Result artifact: " + $ResultPath)
  if (-not $Result.ok) { throw "M2 CEP transport smoke did not pass." }
} finally {
  Pop-Location
}
