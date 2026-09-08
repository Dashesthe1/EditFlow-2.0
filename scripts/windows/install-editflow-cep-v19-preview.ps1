param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AcceptedInstaller = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"

if (-not (Test-Path $AcceptedInstaller -PathType Leaf)) { throw "Accepted EditFlow CEP installer is missing: $AcceptedInstaller" }
& $AcceptedInstaller
if ($LASTEXITCODE -ne 0) { throw "Accepted EditFlow CEP installer failed before protocol 1.9 verification." }

foreach ($RequiredName in @(
  "editflow_host_m3_spatial_graph.jsx",
  "editflow_host_m3_spatial_graph_proof_cleanup.jsx",
  "editflow_host_current_v19.jsx"
)) {
  $RequiredPath = Join-Path $InstalledHost $RequiredName
  if (-not (Test-Path $RequiredPath -PathType Leaf)) { throw "Accepted protocol 1.9 installation is missing host file: $RequiredPath" }
}

$BridgePath = Join-Path $InstalledClient "bridge.js"
if (-not (Test-Path $BridgePath -PathType Leaf)) { throw "Accepted protocol 1.9 installation is missing bridge.js." }
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
if (-not $BridgeText.Contains('var KNOWN_PROTOCOLS = ["1.9.0"')) { throw "Accepted bridge.js does not advertise protocol 1.9 first." }
if (-not $BridgeText.Contains('editflow_host_current_v19.jsx')) { throw "Accepted bridge.js does not load the protocol 1.9 host." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_19')) { throw "Accepted bridge.js does not verify the protocol 1.9 host flag." }

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted installer did not create bridge-config.json." }
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Supported = @($Config.supportedProtocolVersions)
if ($Supported.Count -lt 1 -or [string]$Supported[0] -ne "1.9.0") { throw "Accepted runtime config does not advertise protocol 1.9 first." }

Write-Host "Protocol 1.9 is now part of the accepted standard CEP installation. The former preview installer remains as a compatibility verifier only."
