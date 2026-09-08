param(
  [int]$Port = 32145,
  [switch]$SkipDebugMode,
  [switch]$RotateToken
)

$ErrorActionPreference = "Stop"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535." }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplateRoot = Join-Path $RepoRoot "packages\adapters\ae-cep\extension"
$HostSourceRoot = Join-Path $RepoRoot "packages\adapters\ae-cep\host"
$ExtensionId = "com.editflow2.bridge.panel"
$ExtensionVersion = "0.1.0-dev.8"
$TargetRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$ConfigDir = Join-Path $env:LOCALAPPDATA "EditFlow2"
$ConfigPath = Join-Path $ConfigDir "bridge-config.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $TemplateRoot -PathType Container)) { throw "CEP extension template not found: $TemplateRoot" }

# Preserve the local authentication token across ordinary reinstalls. During active
# development After Effects can still have the previously installed panel in memory;
# rotating the token on every file refresh causes that panel to be rejected by the new
# broker as UNAUTHORIZED. Rotation is explicit via -RotateToken.
$Token = $null
$TokenWasPreserved = $false
if (-not $RotateToken -and (Test-Path $ConfigPath -PathType Leaf)) {
  try {
    $ExistingConfigText = [System.IO.File]::ReadAllText($ConfigPath)
    if ($ExistingConfigText.Length -gt 0 -and [int]$ExistingConfigText[0] -eq 0xFEFF) {
      $ExistingConfigText = $ExistingConfigText.Substring(1)
    }
    $ExistingConfig = $ExistingConfigText | ConvertFrom-Json
    if ($ExistingConfig.token -is [string] -and $ExistingConfig.token.Length -ge 32) {
      $Token = $ExistingConfig.token
      $TokenWasPreserved = $true
    }
  } catch {
    $Token = $null
  }
}

if (-not $Token) {
  $TokenBytes = New-Object byte[] 32
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($TokenBytes) } finally { $Rng.Dispose() }
  $Token = [Convert]::ToBase64String($TokenBytes)
}

if (Test-Path $TargetRoot) { Remove-Item $TargetRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
Copy-Item (Join-Path $TemplateRoot "*") $TargetRoot -Recurse -Force

$InstalledHostDir = Join-Path $TargetRoot "host"
New-Item -ItemType Directory -Force -Path $InstalledHostDir | Out-Null
$HostFiles = @(
  "editflow_json.jsx",
  "editflow_host.jsx",
  "editflow_host_hardening.jsx",
  "editflow_host_transform_readback.jsx",
  "editflow_host_keyframe_crud.jsx",
  "editflow_host_atomicity.jsx",
  "editflow_host_render_jobs.jsx",
  "editflow_host_render_async.jsx",
  "editflow_host_render_output_path.jsx",
  "editflow_host_m3_masks.jsx",
  "editflow_host_m3_composite.jsx",
  "editflow_host_m3_parenting.jsx",
  "editflow_host_m3_null_rigs.jsx",
  "editflow_host_m3_layer_controls.jsx",
  "editflow_host_m3_temporal_interpolation.jsx",
  "editflow_host_m3_temporal_ease.jsx",
  "editflow_host_m3_spatial_graph.jsx",
  "editflow_host_m3_proof_cleanup.jsx",
  "editflow_host_m3_composite_proof_cleanup.jsx",
  "editflow_host_m3_parenting_proof_cleanup.jsx",
  "editflow_host_m3_null_rig_proof_cleanup.jsx",
  "editflow_host_m3_layer_controls_proof_cleanup.jsx",
  "editflow_host_m3_spatial_graph_proof_cleanup.jsx",
  "editflow_host_current.jsx",
  "editflow_host_current_v15.jsx",
  "editflow_host_current_v16.jsx",
  "editflow_host_current_v17.jsx",
  "editflow_host_current_v18.jsx",
  "editflow_host_current_v19.jsx"
)
foreach ($FileName in $HostFiles) {
  $Source = Join-Path $HostSourceRoot $FileName
  if (-not (Test-Path $Source -PathType Leaf)) { throw "Required AE host file is missing: $Source" }
  Copy-Item $Source (Join-Path $InstalledHostDir $FileName) -Force
}

# The checked-in CEP template remains a compatibility-safe source artifact. Promote
# the installed panel to the transfer-accepted 1.9 host only after all required host
# files have copied successfully. Guard every replacement so source drift fails closed.
$BridgePath = Join-Path $TargetRoot "client\bridge.js"
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV18 = 'var KNOWN_PROTOCOLS = ["1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV18)) { throw "CEP bridge protocol list drifted; refusing unverified protocol 1.9 promotion." }
if (-not $BridgeText.Contains('editflow_host_current_v18.jsx')) { throw "CEP bridge host-loader token drifted; refusing unverified protocol 1.9 promotion." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_18')) { throw "CEP bridge host-flag token drifted; refusing unverified protocol 1.9 promotion." }
$BridgeText = $BridgeText.Replace($KnownV18, $KnownV19)
$BridgeText = $BridgeText.Replace('editflow_host_current_v18.jsx', 'editflow_host_current_v19.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_19')
$BridgeText = $BridgeText.Replace('protocol 1.8 host dispatcher', 'protocol 1.9 host dispatcher')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

# Keep the immediately previous transfer-accepted protocol as explicit compatibility
# metadata. Protocol 1.9 is additive; protocol 1.8 remains available for temporal-ease
# sessions and brokers that deliberately negotiate only through that tranche.
$AcceptedV18Compatibility = [ordered]@{
  supportedProtocolVersions = @("1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
  extensionVersion = "0.1.0-dev.8"
  hostLoader = "editflow_host_current_v18.jsx"
  hostFlag = "EditFlow2_HOST_PROTOCOL_18"
}

# Preserve the prior accepted 1.7 client/protocol baseline as compatibility metadata too.
$AcceptedV17Compatibility = [ordered]@{
  supportedProtocolVersions = @("1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
  extensionVersion = "0.1.0-dev.7"
  hostLoader = "editflow_host_current_v17.jsx"
  hostFlag = "EditFlow2_HOST_PROTOCOL_17"
}

# supportedProtocolVersions is an additive schema-1 field. Existing M2 readers ignore it,
# while newer brokers use it to negotiate explicitly scoped protocol tranches.
$Config = [ordered]@{
  schemaVersion = 1
  host = "127.0.0.1"
  port = $Port
  token = $Token
  protocolVersion = "1.1.0"
  supportedProtocolVersions = @("1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
  acceptedV18Compatibility = $AcceptedV18Compatibility
  acceptedV17Compatibility = $AcceptedV17Compatibility
  extensionId = $ExtensionId
  extensionVersion = $ExtensionVersion
}
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$ConfigJson = $Config | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)

$RuntimeConfigPath = Join-Path $TargetRoot "client\runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 4 -Compress
$RuntimeConfig = "window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze($CompactConfig);`r`n"
[System.IO.File]::WriteAllText($RuntimeConfigPath, $RuntimeConfig, $Utf8NoBom)

if (-not $SkipDebugMode) {
  $CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
  New-Item -Path $CsxsKey -Force | Out-Null
  New-ItemProperty -Path $CsxsKey -Name "PlayerDebugMode" -PropertyType String -Value "1" -Force | Out-Null
}

Write-Host "EditFlow 2.0 CEP bridge installed."
Write-Host "Extension: $TargetRoot"
Write-Host "Runtime config: $ConfigPath"
Write-Host "Panel protocols advertised: 1.9.0, 1.8.0, 1.7.0, 1.6.0, 1.5.0, 1.4.0, 1.3.0, 1.2.0, 1.1.0"
Write-Host "Each local broker narrows that set to the protocol tranches its current proof/runtime supports."
Write-Host "Broker: 127.0.0.1:$Port"
if (-not $SkipDebugMode) { Write-Host "CEP 12 PlayerDebugMode enabled for this Windows user." }
if ($TokenWasPreserved) {
  Write-Host "Authentication token preserved from the existing local EditFlow config."
} elseif ($RotateToken) {
  Write-Host "Authentication token rotated locally by explicit request."
} else {
  Write-Host "Authentication token generated locally for this Windows user."
}
Write-Host "Restart After Effects after updating installed extension files."
Write-Host "The authentication token is not printed here."
