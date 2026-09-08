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
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $AcceptedInstaller -PathType Leaf)) { throw "Accepted EditFlow CEP installer is missing: $AcceptedInstaller" }
& $AcceptedInstaller -Port $Port
if ($LASTEXITCODE -ne 0) { throw "Accepted EditFlow CEP installer failed before protocol 1.10 preview installation." }

$MotionHostSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_motion_render.jsx"
$V110LoaderSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v110.jsx"
foreach ($RequiredSource in @($MotionHostSource, $V110LoaderSource)) {
  if (-not (Test-Path $RequiredSource -PathType Leaf)) { throw "Protocol 1.10 proof host source is missing: $RequiredSource" }
}
Copy-Item $MotionHostSource (Join-Path $InstalledHost "editflow_host_m3_motion_render.jsx") -Force
Copy-Item $V110LoaderSource (Join-Path $InstalledHost "editflow_host_current_v110.jsx") -Force

$BridgePath = Join-Path $InstalledClient "bridge.js"
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV110 = 'var KNOWN_PROTOCOLS = ["1.10.0","1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV19)) { throw "Installed bridge.js protocol list drifted; refusing unverified protocol 1.10 proof patch." }
if (-not $BridgeText.Contains('editflow_host_current_v19.jsx')) { throw "Installed bridge.js accepted protocol 1.9 host-loader token drifted." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_19')) { throw "Installed bridge.js accepted protocol 1.9 host flag token drifted." }
$BridgeText = $BridgeText.Replace($KnownV19, $KnownV110)
$BridgeText = $BridgeText.Replace('editflow_host_current_v19.jsx', 'editflow_host_current_v110.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_19', 'EditFlow2_HOST_PROTOCOL_110')
$BridgeText = $BridgeText.Replace('protocol 1.9 host dispatcher', 'protocol 1.10 host dispatcher')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted installer did not create bridge-config.json." }
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Config.supportedProtocolVersions = @("1.10.0", "1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
$ConfigJson = $Config | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)

$RuntimeConfigPath = Join-Path $InstalledClient "runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, ("window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze(" + $CompactConfig + ");`r`n"), $Utf8NoBom)

Write-Host "Isolated EditFlow protocol 1.10 motion-render preview installed for proof only."
Write-Host "Accepted production runtime remains protocol 1.9 outside this isolated proof."
Write-Host "Preview protocols advertised: 1.10.0 through 1.1.0"
