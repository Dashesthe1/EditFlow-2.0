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
$ExtensionVersion = "0.1.0-dev.4"
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
  "editflow_host_current.jsx"
)
foreach ($FileName in $HostFiles) {
  $Source = Join-Path $HostSourceRoot $FileName
  if (-not (Test-Path $Source -PathType Leaf)) { throw "Required AE host file is missing: $Source" }
  Copy-Item $Source (Join-Path $InstalledHostDir $FileName) -Force
}

$Config = [ordered]@{
  schemaVersion = 2
  host = "127.0.0.1"
  port = $Port
  token = $Token
  # Keep the legacy single-version field at the accepted M2 value so an older local
  # broker can still reject safely rather than being told that M2 itself changed.
  protocolVersion = "1.1.0"
  supportedProtocolVersions = @("1.2.0", "1.1.0")
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
Write-Host "Broker protocols: 1.2.0, 1.1.0 (highest mutually supported version is negotiated per session)"
Write-Host "M3 mask host protocol 1.2.0 is enabled only when the authenticated broker session advertises it."
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
