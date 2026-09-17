param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$ProofScriptEndpoint = "http://127.0.0.1:32146/proof-script"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ResultPath = Join-Path $ArtifactDir "result.json"
$ProbeScript = Join-Path $RepoRoot "scripts\windows\m5-mocha-ae-discovery-probe.jsx"
$ProbeMarker = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-discovery.txt"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$BaselineAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
if ($BaselineAePids.Count -ne 1) { throw "Mocha discovery requires exactly one already-running After Effects process; found $($BaselineAePids.Count)." }
Remove-Item $ResultPath,$ProbeMarker -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $ProbeScript -PathType Leaf)) { throw "Required Mocha discovery probe missing: $ProbeScript" }
$Timer = [System.Diagnostics.Stopwatch]::StartNew()
$body = @{ scriptPath = $ProbeScript } | ConvertTo-Json -Compress
try { $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $ProofScriptEndpoint -ContentType "application/json" -Body $body -TimeoutSec 10 } catch { throw "Warm CEP discovery dispatch failed: $($_.Exception.Message)" }
$payload = $response.Content | ConvertFrom-Json
if ($response.StatusCode -ne 200 -or $payload.ok -ne $true) { throw "Warm CEP discovery dispatch refused." }
$Deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds - 2))
while (-not (Test-Path $ProbeMarker -PathType Leaf) -and (Get-Date) -lt $Deadline) { Start-Sleep -Milliseconds 50 }
$Timer.Stop()
if (-not (Test-Path $ProbeMarker -PathType Leaf)) { throw "Mocha discovery marker was not produced before timeout." }
$Lines = @(Get-Content $ProbeMarker -ErrorAction Stop)
function Field([string]$Name) {
  $line = $Lines | Where-Object { $_ -like ($Name + "`t*") } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "`t", 2)[1]
}
$ExactLine = $Lines | Where-Object { $_ -like "EXACT`t*" } | Select-Object -First 1
$ExactParts = if ($ExactLine) { $ExactLine -split "`t", 5 } else { @() }
$Exact = if ($ExactParts.Count -ge 3 -and $ExactParts[1] -and $ExactParts[2]) {
  [ordered]@{ displayName = $ExactParts[1]; matchName = $ExactParts[2] }
} else { $null }
$Effects = @($Lines | Where-Object { $_ -like "EFFECT`t*" } | ForEach-Object {
  $p = $_ -split "`t", 5
  [ordered]@{ displayName = $p[1]; matchName = $p[2]; category = if ($p.Count -gt 3) { $p[3] } else { "" }; version = if ($p.Count -gt 4) { $p[4] } else { "" } }
})
$AfterAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
$SameAeProcess = (($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
$ProjectUnchanged = (Field "REVISION_BEFORE") -eq (Field "REVISION_AFTER") -and (Field "ITEMS_BEFORE") -eq (Field "ITEMS_AFTER")
$RoundtripMs = [Math]::Round($Timer.Elapsed.TotalMilliseconds, 3)
$CanAddText = Field "CAN_ADD"
$CanAdd = if ($CanAddText -eq "true") { $true } elseif ($CanAddText -eq "false") { $false } else { $null }
$Ok = ($null -ne $Exact) -and $SameAeProcess -and $ProjectUnchanged
$Result = [ordered]@{
  proofId = "M5_MOCHA_AE_DISCOVERY_REAL_AE_V1"
  proofDispatchMode = "WARM_CEP_PROOF_SCRIPT"
  classification = if ($Ok) { "PASS" } else { "PRODUCT_FAILURE" }
  ok = $Ok
  mutationStarted = $false
  cleanupComplete = $true
  baselineAePids = $BaselineAePids
  afterAePids = $AfterAePids
  sameAeProcess = $SameAeProcess
  projectUnchanged = $ProjectUnchanged
  roundtripMs = $RoundtripMs
  hostVersion = Field "HOST_VERSION"
  projectPath = Field "PROJECT_PATH"
  activeItemName = Field "ACTIVE_ITEM"
  targetLayerName = Field "TARGET_LAYER"
  activeLayerCanAddMochaAe = $CanAdd
  exactMochaAe = $Exact
  mochaEffects = $Effects
  message = if ($Ok) { "Mocha AE was discovered through AE registered effect metadata without mutating the project or replacing the warm AE process." } else { "Mocha AE discovery did not satisfy plugin identity, same-process, and read-only project gates." }
}
[System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 12) + [Environment]::NewLine), $Utf8NoBom)
if (-not $Ok) { Write-Error $Result.message; exit 1 }
Write-Host $Result.message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Discovery roundtrip: " + $RoundtripMs + " ms")
Write-Host ("Mocha match: " + $Exact.displayName + " / " + $Exact.matchName)
