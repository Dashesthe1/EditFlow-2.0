param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$BadScript = Join-Path $ArtifactDir "intentional-bad-syntax.jsx"
[System.IO.File]::WriteAllText($BadScript, "(function () {`n  var intentionalPopupGuardFailure = ;`n}());`n", (New-Object System.Text.UTF8Encoding($false)))
$Arguments = @('-r', $BadScript)
[void](Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru)
Start-Sleep -Seconds ([Math]::Min(20, [Math]::Max(10, $TimeoutSeconds - 2)))
exit 9
