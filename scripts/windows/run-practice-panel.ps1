param([switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
# One launcher for both modes; reuse the canonical daemon and warm CEP panel.
& (Join-Path $PSScriptRoot 'Start_Current_EditFlow_Shadow.ps1') -LocalOnly:$LocalOnly
if ($LASTEXITCODE) { exit $LASTEXITCODE }
