param(
  [int]$Port = 32145
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535." }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AcceptedInstaller = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$TargetRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"

if (-not (Test-Path $AcceptedInstaller -PathType Leaf)) { throw "Accepted CEP installer is missing: $AcceptedInstaller" }

# Protocol 2.0 is transfer-accepted. Keep this former preview entry point only as a
# compatibility surface for existing proof workflows; the standard installer is now
# the single authority and preserves the existing local authentication token.
& $AcceptedInstaller -Port $Port -SkipDebugMode

$BridgePath = Join-Path $TargetRoot "client\bridge.js"
if (-not (Test-Path $BridgePath -PathType Leaf)) { throw "Installed CEP bridge is missing: $BridgePath" }
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV20 = 'var KNOWN_PROTOCOLS = ["2.0.0","1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV20)) { throw "Accepted CEP bridge does not advertise protocol 2.0 first." }
if (-not $BridgeText.Contains('editflow_host_current_v20.jsx')) { throw "Accepted CEP bridge does not load protocol 2.0." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_20')) { throw "Accepted CEP bridge does not verify protocol 2.0 host registration." }

foreach ($FileName in @("editflow_host_m3_marker_motion.jsx", "editflow_host_current_v20.jsx")) {
  if (-not (Test-Path (Join-Path $TargetRoot "host\$FileName") -PathType Leaf)) {
    throw "Accepted protocol-2.0 host file is missing after standard install: $FileName"
  }
}

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted CEP config is missing after install: $ConfigPath" }
$ConfigText = [System.IO.File]::ReadAllText($ConfigPath)
if ($ConfigText.Length -gt 0 -and [int]$ConfigText[0] -eq 0xFEFF) { $ConfigText = $ConfigText.Substring(1) }
$Config = $ConfigText | ConvertFrom-Json
if (@($Config.supportedProtocolVersions)[0] -ne "2.0.0") { throw "Accepted CEP config does not advertise protocol 2.0 first." }
if ($Config.extensionVersion -ne "0.1.0-dev.10") { throw "Accepted CEP config extension version is not protocol-2.0 build 0.1.0-dev.10." }

Write-Host "EditFlow 2.0 protocol-2.0 accepted runtime verified through the standard installer."
Write-Host "Panel protocols advertised: 2.0.0 through 1.1.0."
Write-Host "This compatibility entry point no longer installs a separate preview runtime."
