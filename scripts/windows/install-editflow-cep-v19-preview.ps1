param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AcceptedInstaller = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $AcceptedInstaller -PathType Leaf)) { throw "Accepted EditFlow CEP installer is missing: $AcceptedInstaller" }
& $AcceptedInstaller
if ($LASTEXITCODE -ne 0) { throw "Accepted EditFlow CEP installer failed before protocol 1.9 preview patch." }

$SpatialHostSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_spatial_graph.jsx"
$V19LoaderSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v19.jsx"
foreach ($RequiredSource in @($SpatialHostSource, $V19LoaderSource)) {
  if (-not (Test-Path $RequiredSource -PathType Leaf)) { throw "Protocol 1.9 proof host source is missing: $RequiredSource" }
}
if (-not (Test-Path $InstalledHost -PathType Container) -or -not (Test-Path $InstalledClient -PathType Container)) {
  throw "Accepted installer did not create the expected isolated CEP installation."
}
if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted installer did not create bridge-config.json." }

Copy-Item $SpatialHostSource (Join-Path $InstalledHost "editflow_host_m3_spatial_graph.jsx") -Force
Copy-Item $V19LoaderSource (Join-Path $InstalledHost "editflow_host_current_v19.jsx") -Force

$BridgePath = Join-Path $InstalledClient "bridge.js"
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV18 = 'var KNOWN_PROTOCOLS = ["1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV18)) { throw "Installed bridge.js protocol list drifted; refusing unverified v19 preview patch." }
if (-not $BridgeText.Contains('editflow_host_current_v18.jsx')) { throw "Installed bridge.js accepted host-loader token drifted." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_18')) { throw "Installed bridge.js accepted host-flag token drifted." }
$BridgeText = $BridgeText.Replace($KnownV18, $KnownV19)
$BridgeText = $BridgeText.Replace('editflow_host_current_v18.jsx', 'editflow_host_current_v19.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_19')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Config.supportedProtocolVersions = @("1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
$ConfigJson = $Config | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)

$RuntimeConfigPath = Join-Path $InstalledClient "runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, ("window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze(" + $CompactConfig + ");`r`n"), $Utf8NoBom)

Write-Host "Installed isolated protocol 1.9 spatial-graph preview. Repository/default installer remains accepted protocol 1.8."
