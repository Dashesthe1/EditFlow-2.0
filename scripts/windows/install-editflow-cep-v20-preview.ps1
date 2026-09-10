param(
  [int]$Port = 32145
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535." }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BaseInstaller = Join-Path $RepoRoot "scripts\windows\install-editflow-cep.ps1"
$HostSourceRoot = Join-Path $RepoRoot "packages\adapters\ae-cep\host"
$TargetRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $BaseInstaller -PathType Leaf)) { throw "Accepted CEP installer is missing: $BaseInstaller" }

# Always rebuild the installed preview from the accepted protocol-1.9 baseline. The
# base installer preserves the authentication token, so refreshing proof code does not
# invalidate an already-open panel solely because files were recopied. This is a
# PowerShell script boundary, so ErrorActionPreference/throw is authoritative; do not
# interpret a stale $LASTEXITCODE left by an internal native command as installer failure.
& $BaseInstaller -Port $Port -SkipDebugMode

$InstalledHostDir = Join-Path $TargetRoot "host"
foreach ($FileName in @("editflow_host_m3_marker_motion.jsx", "editflow_host_current_v20.jsx")) {
  $Source = Join-Path $HostSourceRoot $FileName
  if (-not (Test-Path $Source -PathType Leaf)) { throw "Required protocol-2.0 host file is missing: $Source" }
  Copy-Item $Source (Join-Path $InstalledHostDir $FileName) -Force
}

$BridgePath = Join-Path $TargetRoot "client\bridge.js"
if (-not (Test-Path $BridgePath -PathType Leaf)) { throw "Installed CEP bridge is missing: $BridgePath" }
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV20 = 'var KNOWN_PROTOCOLS = ["2.0.0","1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV19)) { throw "Installed CEP bridge protocol list drifted; refusing unverified protocol 2.0 preview." }
if (-not $BridgeText.Contains('editflow_host_current_v19.jsx')) { throw "Installed CEP bridge host-loader token drifted; refusing protocol 2.0 preview." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_19')) { throw "Installed CEP bridge host-flag token drifted; refusing protocol 2.0 preview." }
$BridgeText = $BridgeText.Replace($KnownV19, $KnownV20)
$BridgeText = $BridgeText.Replace('editflow_host_current_v19.jsx', 'editflow_host_current_v20.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_19', 'EditFlow2_HOST_PROTOCOL_20')
$BridgeText = $BridgeText.Replace('protocol 1.9 host dispatcher', 'protocol 2.0 host dispatcher')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw "Accepted CEP config is missing after install: $ConfigPath" }
$ConfigText = [System.IO.File]::ReadAllText($ConfigPath)
if ($ConfigText.Length -gt 0 -and [int]$ConfigText[0] -eq 0xFEFF) { $ConfigText = $ConfigText.Substring(1) }
$Config = $ConfigText | ConvertFrom-Json
$Config.supportedProtocolVersions = @("2.0.0", "1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
$Config.extensionVersion = "0.1.0-dev.10"
$ConfigJson = $Config | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)

$RuntimeConfigPath = Join-Path $TargetRoot "client\runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, "window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze($CompactConfig);`r`n", $Utf8NoBom)

Write-Host "EditFlow 2.0 protocol-2.0 marker/motion preview installed."
Write-Host "Panel protocols advertised: 2.0.0 through 1.1.0."
Write-Host "A panel/process reload is required the first time this preview replaces an already-running protocol-1.9 panel."
Write-Host "Subsequent REUSE_AE proofs may keep the same healthy After Effects process while the installed preview remains unchanged."