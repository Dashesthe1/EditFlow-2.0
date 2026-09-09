param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
$Inner = Join-Path $PSScriptRoot 'run-ae-senses-eyes-ears-v2.ps1'
if (-not (Test-Path $Inner -PathType Leaf)) { throw "Missing sensory proof: $Inner" }
& $Inner -AfterFxPath $AfterFxPath -TimeoutSeconds ([Math]::Max(60, $TimeoutSeconds - 10))
$Code = $LASTEXITCODE
# The proof's own same-PID health check has already passed. Give AE a short idle
# settlement window after the temporary comp/source removal before the outer
# workstation harness independently samples Process.Responding.
Start-Sleep -Seconds 6
exit $Code
