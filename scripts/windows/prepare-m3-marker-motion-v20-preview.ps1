param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$BridgePath = Join-Path $InstalledClient "bridge.js"
$RuntimeConfigPath = Join-Path $InstalledClient "runtime-config.js"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($RequiredPath in @($InstalledRoot, $InstalledHost, $InstalledClient)) {
  if (-not (Test-Path $RequiredPath -PathType Container)) { throw "Installed EditFlow CEP preview path is missing: $RequiredPath" }
}
foreach ($RequiredFile in @($ConfigPath, $BridgePath)) {
  if (-not (Test-Path $RequiredFile -PathType Leaf)) { throw "Installed EditFlow CEP preview file is missing: $RequiredFile" }
}

$MarkerMotionHostSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_marker_motion.jsx"
$V20LoaderSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v20.jsx"
foreach ($Source in @($MarkerMotionHostSource, $V20LoaderSource)) {
  if (-not (Test-Path $Source -PathType Leaf)) { throw "Protocol 2.0 preview source is missing: $Source" }
}
Copy-Item -LiteralPath $MarkerMotionHostSource -Destination (Join-Path $InstalledHost "editflow_host_m3_marker_motion.jsx") -Force
Copy-Item -LiteralPath $V20LoaderSource -Destination (Join-Path $InstalledHost "editflow_host_current_v20.jsx") -Force

$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
if ($BridgeText -notmatch 'var KNOWN_PROTOCOLS = \[[^\]]*"2\.0\.0"') {
  if ($BridgeText -notmatch 'var KNOWN_PROTOCOLS = \[') { throw "Installed bridge.js KNOWN_PROTOCOLS declaration is missing." }
  $BridgeText = [regex]::Replace($BridgeText, 'var KNOWN_PROTOCOLS = \[', 'var KNOWN_PROTOCOLS = ["2.0.0",', 1)
}
if ($BridgeText.Contains('editflow_host_current_v19.jsx')) { $BridgeText = $BridgeText.Replace('editflow_host_current_v19.jsx', 'editflow_host_current_v20.jsx') }
elseif ($BridgeText.Contains('editflow_host_current_v18.jsx')) { $BridgeText = $BridgeText.Replace('editflow_host_current_v18.jsx', 'editflow_host_current_v20.jsx') }
elseif (-not $BridgeText.Contains('editflow_host_current_v20.jsx')) { throw "Installed bridge.js host-loader token is not a recognized accepted/v20 form." }
if ($BridgeText.Contains('EditFlow2_HOST_PROTOCOL_19')) { $BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_19', 'EditFlow2_HOST_PROTOCOL_20') }
elseif ($BridgeText.Contains('EditFlow2_HOST_PROTOCOL_18')) { $BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_20') }
elseif (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_20')) { throw "Installed bridge.js host protocol flag is not a recognized accepted/v20 form." }
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$ExistingSupported = @($Config.supportedProtocolVersions | ForEach-Object { [string]$_ })
$Supported = @("2.0.0")
foreach ($Version in $ExistingSupported) { if ($Version -and $Supported -notcontains $Version) { $Supported += $Version } }
if ($Supported -notcontains "1.1.0") { $Supported += "1.1.0" }
$Config.supportedProtocolVersions = $Supported
$ConfigJson = $Config | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)
$Compact = $Config | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, ("window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze(" + $Compact + ");`r`n"), $Utf8NoBom)

Write-Host "Prepared protocol 2.0 marker-motion preview in place without closing or restarting After Effects."
Write-Host "The currently loaded CEP page is intentionally not forced to reload; a restart is required only if that live page was not already v20-capable."
