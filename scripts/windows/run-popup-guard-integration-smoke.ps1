param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ResultPath = Join-Path $ArtifactDir "result.json"
$BadScript = Join-Path $ArtifactDir "intentional-bad-syntax.jsx"
$ProbeScript = Join-Path $ArtifactDir "post-popup-health-probe.jsx"
$ProbeMarker = Join-Path $ArtifactDir "post-popup-health-probe.txt"
$SupervisorLog = Join-Path $ArtifactDir "ae-host-supervisor.log"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$BaselineAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
if ($BaselineAePids.Count -ne 1) { throw "Popup guard proof requires exactly one already-running After Effects process; found $($BaselineAePids.Count)." }
Remove-Item $ResultPath,$BadScript,$ProbeScript,$ProbeMarker -Force -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText($BadScript, "(function () {`n  var intentionalPopupGuardFailure = ;`n}());`n", $Utf8NoBom)
$MarkerForJs = $ProbeMarker.Replace('\','/').Replace('"','\"')
$ProbeSource = @"
(function () {
  var out = new File("$MarkerForJs");
  if (!out.open("w")) throw new Error("EDITFLOW_POST_POPUP_PROBE_OPEN_FAILED");
  var projectPath = (app.project && app.project.file) ? app.project.file.fsName : "";
  out.write("OK|" + app.version + "|" + projectPath);
  out.close();
}());
"@
[System.IO.File]::WriteAllText($ProbeScript, $ProbeSource, $Utf8NoBom)
function Invoke-AeScript {
  param([Parameter(Mandatory = $true)][string]$Path)
  $Arguments = @('-r', $Path)
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru)
}
$Timer = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-AeScript -Path $BadScript
Start-Sleep -Milliseconds 400
Invoke-AeScript -Path $ProbeScript
$Deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds - 2))
while (-not (Test-Path $ProbeMarker -PathType Leaf) -and (Get-Date) -lt $Deadline) {
  Start-Sleep -Milliseconds 100
}
$Timer.Stop()
$ProbeResponsive = Test-Path $ProbeMarker -PathType Leaf
$AfterAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
$SameAeProcess = (($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
$SupervisorLines = if (Test-Path $SupervisorLog -PathType Leaf) { @(Get-Content $SupervisorLog -ErrorAction SilentlyContinue) } else { @() }
$ScriptErrorDetected = @($SupervisorLines | Where-Object { $_ -like "*`tSCRIPT_ERROR_DETECTED`t*" }).Count -gt 0
$ScriptErrorDismissed = @($SupervisorLines | Where-Object { $_ -match "`tDISMISS_SCRIPT_ERROR_(NATIVE|UIA|OCR_ENTER)`t" }).Count -gt 0
$RecoveryRoundtripMs = [Math]::Round($Timer.Elapsed.TotalMilliseconds, 3)
$WithinThreeSecondCeiling = $RecoveryRoundtripMs -le 3000
$Ok = $ProbeResponsive -and $SameAeProcess -and $ScriptErrorDetected -and $ScriptErrorDismissed -and $WithinThreeSecondCeiling
$Result = [ordered]@{
  proofId = "AE_POPUP_GUARD_EXPECTED_SCRIPT_ERROR_REAL_AE_V1"
  classification = if ($Ok) { "PASS" } else { "PRODUCT_FAILURE" }
  ok = $Ok
  mutationStarted = $false
  cleanupComplete = $true
  popupFaultInjected = $true
  scriptErrorDetectedInSupervisor = $ScriptErrorDetected
  scriptErrorDismissedBySupervisor = $ScriptErrorDismissed
  postFaultAeResponsive = $ProbeResponsive
  baselineAePids = $BaselineAePids
  afterAePids = $AfterAePids
  sameAeProcess = $SameAeProcess
  recoveryRoundtripMs = $RecoveryRoundtripMs
  withinThreeSecondCeiling = $WithinThreeSecondCeiling
  message = if ($Ok) { "Expected AE script-error popup was detected, safely dismissed, and the same warm AE process accepted a follow-up script within the latency ceiling." } else { "Popup guard proof did not satisfy detection, dismissal, same-process responsiveness, and latency gates." }
}
[System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $Utf8NoBom)
if (-not $Ok) { Write-Error $Result.message; exit 1 }
Write-Host $Result.message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Popup recovery roundtrip: " + $RecoveryRoundtripMs + " ms")
