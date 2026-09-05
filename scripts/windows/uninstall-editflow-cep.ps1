param(
  [switch]$KeepRuntimeConfig
)

$ErrorActionPreference = "Stop"
$TargetRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"

if (Test-Path $TargetRoot) {
  Remove-Item $TargetRoot -Recurse -Force
  Write-Host "Removed EditFlow 2.0 CEP extension: $TargetRoot"
} else {
  Write-Host "EditFlow 2.0 CEP extension was not installed at: $TargetRoot"
}

if (-not $KeepRuntimeConfig -and (Test-Path $ConfigPath)) {
  Remove-Item $ConfigPath -Force
  Write-Host "Removed EditFlow 2.0 bridge runtime config."
}

Write-Host "PlayerDebugMode is left unchanged because it is a shared CEP development preference."
