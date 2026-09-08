param(
  [int]$Port = 32145
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AcceptedInstaller = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"

if (-not (Test-Path $AcceptedInstaller -PathType Leaf)) { throw "Accepted EditFlow CEP installer is missing: $AcceptedInstaller" }
try { & $AcceptedInstaller -Port $Port }
catch { throw "Accepted EditFlow CEP installer failed before protocol 1.9 compatibility verification: $($_.Exception.Message)" }

foreach ($RequiredName in @("editflow_host_m3_spatial_graph.jsx", "editflow_host_m3_spatial_graph_proof_cleanup.jsx", "editflow_host_current_v19.jsx", "editflow_host_current_v110.jsx")) {
  $RequiredPath = Join-Path $InstalledHost $RequiredName
  if (-not (Test-Path $RequiredPath -PathType Leaf)) { throw "Accepted installation is missing protocol 1.9 compatibility host file: $RequiredPath" }
}

$BridgePath = Join-Path $InstalledClient "bridge.js"
if (-not (Test-Path $BridgePath -PathType Leaf)) { throw "Accepted installation is missing bridge.js." }
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
if (-not $BridgeText.Contains('var KNOWN_PROTOCOLS = ["1.10.0","1.9.0"')) { throw "Accepted bridge.js does not advertise transfer-accepted protocol 1.10 with 1.9 compatibility." }
if (-not $BridgeText.Contains('editflow_host_current_v110.jsx')) { throw "Accepted bridge.js does not load the accepted protocol 1.10 host." }

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted installer did not create bridge-config.json." }
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Supported = @($Config.supportedProtocolVersions)
if ($Supported -notcontains "1.9.0") { throw "Accepted runtime config no longer advertises protocol 1.9 compatibility." }
if ($null -eq $Config.acceptedV19Compatibility) { throw "Accepted runtime config is missing acceptedV19Compatibility." }
if ([string]$Config.acceptedV19Compatibility.hostLoader -ne "editflow_host_current_v19.jsx" -or [string]$Config.acceptedV19Compatibility.hostFlag -ne "EditFlow2_HOST_PROTOCOL_19") { throw "Accepted protocol 1.9 compatibility metadata is invalid." }

Write-Host "Protocol 1.9 remains an accepted compatibility tranche beneath the standard protocol 1.10 installation."
Write-Host "The former v1.9 preview installer remains as a compatibility verifier only."
