param(
  [int]$Port = 32145,
  [switch]$SkipDebugMode
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

$TokenBytes = New-Object byte[] 32
$Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $Rng.GetBytes($TokenBytes) } finally { $Rng.Dispose() }
$Token = [Convert]::ToBase64String($TokenBytes)

if (Test-Path $TargetRoot) { Remove-Item $TargetRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
Copy-Item (Join-Path $TemplateRoot "*") $TargetRoot -Recurse -Force

$InstalledHostDir = Join-Path $TargetRoot "host"
New-Item -ItemType Directory -Force -Path $InstalledHostDir | Out-Null
$HostFiles = @(
  "editflow_host.jsx",
  "editflow_host_hardening.jsx",
  "editflow_host_atomicity.jsx",
  "editflow_host_current.jsx"
)
foreach ($FileName in $HostFiles) {
  $Source = Join-Path $HostSourceRoot $FileName
  if (-not (Test-Path $Source -PathType Leaf)) { throw "Required AE host file is missing: $Source" }
  Copy-Item $Source (Join-Path $InstalledHostDir $FileName) -Force
}

$Config = [ordered]@{
  schemaVersion = 1
  host = "127.0.0.1"
  port = $Port
  token = $Token
  protocolVersion = "1.1.0"
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
Write-Host "Protocol: 1.1.0"
Write-Host "Broker: 127.0.0.1:$Port"
if (-not $SkipDebugMode) { Write-Host "CEP 12 PlayerDebugMode enabled for this Windows user." }
Write-Host "Restart After Effects, then open Window > Extensions (Legacy) > EditFlow 2.0 Bridge."
Write-Host "The authentication token was generated locally and is not printed here."
