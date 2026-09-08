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
catch { throw "Accepted EditFlow CEP installer failed before protocol 1.10 compatibility verification: $($_.Exception.Message)" }

foreach ($RequiredName in @("editflow_host_m3_motion_render.jsx", "editflow_host_current_v110.jsx", "editflow_host_current_v19.jsx")) {
  $RequiredPath = Join-Path $InstalledHost $RequiredName
  if (-not (Test-Path $RequiredPath -PathType Leaf)) { throw "Accepted protocol 1.10 installation is missing host file: $RequiredPath" }
}

$BridgePath = Join-Path $InstalledClient "bridge.js"
if (-not (Test-Path $BridgePath -PathType Leaf)) { throw "Accepted protocol 1.10 installation is missing bridge.js." }
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
if (-not $BridgeText.Contains('var KNOWN_PROTOCOLS = ["1.10.0","1.9.0"')) { throw "Accepted bridge.js does not advertise protocol 1.10 first." }
if (-not $BridgeText.Contains('editflow_host_current_v110.jsx')) { throw "Accepted bridge.js does not load the protocol 1.10 host." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_110')) { throw "Accepted bridge.js does not verify the protocol 1.10 host flag." }

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted installer did not create bridge-config.json." }
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Supported = @($Config.supportedProtocolVersions)
if ($Supported.Count -lt 2 -or [string]$Supported[0] -ne "1.10.0" -or [string]$Supported[1] -ne "1.9.0") { throw "Accepted runtime config does not advertise protocol 1.10 first with protocol 1.9 compatibility." }
if ($null -eq $Config.acceptedV19Compatibility -or [string]$Config.acceptedV19Compatibility.hostLoader -ne "editflow_host_current_v19.jsx") { throw "Accepted runtime config is missing protocol 1.9 compatibility metadata." }

Write-Host "Protocol 1.10 motion-render is now part of the accepted standard CEP installation."
Write-Host "The former preview installer remains as a compatibility verifier only; it performs no protocol patching."
