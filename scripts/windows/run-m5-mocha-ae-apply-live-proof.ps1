param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ResultPath = Join-Path $ArtifactDir "result.json"
$SourceProbe = Join-Path $RepoRoot "scripts\windows\m5-mocha-ae-source-probe.jsx"
$EnterScript = Join-Path $RepoRoot "scripts\windows\m5-mocha-ae-isolation-enter.jsx"
$FixtureScript = Join-Path $RepoRoot "scripts\windows\m5-mocha-ae-fixture-apply.jsx"
$RestoreScript = Join-Path $RepoRoot "scripts\windows\m5-mocha-ae-isolation-restore.jsx"
$StatePath = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-isolation-state.json"
$SourceMarker = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-source.json"
$EnterMarker = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-isolation-enter.json"
$FixtureInput = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-fixture-input.json"
$FixtureMarker = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-fixture-result.json"
$RestoreMarker = Join-Path $env:TEMP "EditFlow2-m5-mocha-ae-isolation-restore.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Wait-JsonMarker([string]$Path, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline -and -not (Test-Path $Path -PathType Leaf)) { Start-Sleep -Milliseconds 50 }
  if (-not (Test-Path $Path -PathType Leaf)) { throw "$Label timed out waiting for $Path" }
  $readDeadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $readDeadline) { try { return ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json) } catch { Start-Sleep -Milliseconds 25 } }
  throw "$Label marker was not valid JSON: $Path"
}
function Invoke-AeScriptTimed([string]$ScriptPath, [string]$MarkerPath, [string]$Label) {
  if (-not (Test-Path $ScriptPath -PathType Leaf)) { throw "Required AE script missing: $ScriptPath" }
  Remove-Item $MarkerPath -Force -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r', $ScriptPath) -PassThru)
  $value = Wait-JsonMarker $MarkerPath $TimeoutSeconds $Label
  $sw.Stop()
  return [pscustomobject]@{ value = $value; roundtripMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 3) }
}
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "M5 Mocha AE apply proof did not complete."
$MutationStarted = $false
$CleanupComplete = $false
$BaselinePids = @(); $AfterPids = @(); $SameAeProcess = $false
$Source = $null; $Enter = $null; $Fixture = $null; $Restore = $null
$SourceMs = $null; $EnterMs = $null; $ApplyMs = $null; $RestoreMs = $null
$PrimaryFailure = $null; $RestoreFailure = $null; $RestoreAttempted = $false
try {
  foreach ($required in @($AfterFxPath,$SourceProbe,$EnterScript,$FixtureScript,$RestoreScript)) {
    if (-not (Test-Path $required -PathType Leaf)) { throw "Required proof file missing: $required" }
  }
  $running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($running.Count -ne 1) { throw "Mocha proof requires exactly one already-running After Effects process; found $($running.Count)." }
  if (-not $running[0].Responding -or $running[0].MainWindowHandle -eq 0) { throw "The existing After Effects process is not a responsive visible target." }
  $BaselinePids = @($running | ForEach-Object { $_.Id } | Sort-Object)
  Remove-Item $StatePath,$SourceMarker,$EnterMarker,$FixtureInput,$FixtureMarker,$RestoreMarker -Force -ErrorAction SilentlyContinue
  $probeRun = Invoke-AeScriptTimed $SourceProbe $SourceMarker "Mocha source probe"
  $Source = $probeRun.value; $SourceMs = $probeRun.roundtripMs
  if ($Source.ok -ne $true -or -not $Source.sourcePath) { throw "Mocha source probe refused: $($Source.failure)" }
  $enterRun = Invoke-AeScriptTimed $EnterScript $EnterMarker "Mocha isolation entry"
  $Enter = $enterRun.value; $EnterMs = $enterRun.roundtripMs
  if ($Enter.version -ne "M5_MOCHA_AE_ISOLATION_V1" -or $Enter.ok -ne $true) { throw "Mocha isolation entry refused: $($Enter.failure)" }
  $Classification = "PRODUCT_FAILURE"
  $input = [ordered]@{ sourcePath = [string]$Source.sourcePath }
  [IO.File]::WriteAllText($FixtureInput, (($input | ConvertTo-Json -Depth 4) + [Environment]::NewLine), $Utf8NoBom)
  $fixtureRun = Invoke-AeScriptTimed $FixtureScript $FixtureMarker "Mocha effect apply"
  $Fixture = $fixtureRun.value; $ApplyMs = $fixtureRun.roundtripMs
  $MutationStarted = [bool]$Fixture.mutationStarted
  if ($Fixture.ok -ne $true) { throw "Mocha effect apply refused: $($Fixture.failure)" }
  if ([string]$Fixture.effectMatchName -ne "mochaAECC") { throw "Mocha effect match-name readback mismatch." }
  if ([int]$Fixture.effectCountAfter -ne ([int]$Fixture.effectCountBefore + 1)) { throw "Mocha effect count did not increase exactly once." }
} catch {
  $PrimaryFailure = $_.Exception.Message
} finally {
  if (Test-Path $StatePath -PathType Leaf) {
    $RestoreAttempted = $true
    try {
      $restoreRun = Invoke-AeScriptTimed $RestoreScript $RestoreMarker "Mocha isolation restore"
      $Restore = $restoreRun.value; $RestoreMs = $restoreRun.roundtripMs
      if ($Restore.version -ne "M5_MOCHA_AE_ISOLATION_V1" -or $Restore.ok -ne $true) { throw "Mocha isolation restore refused: $($Restore.failure)" }
      $CleanupComplete = $true
    } catch { $RestoreFailure = $_.Exception.Message }
  }
  $AfterPids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  $SameAeProcess = (($BaselinePids -join ',') -eq ($AfterPids -join ',')) -and $BaselinePids.Count -eq 1
  if ($null -eq $PrimaryFailure -and $null -eq $RestoreFailure -and $RestoreAttempted -and $CleanupComplete -and $SameAeProcess) {
    $Classification = "PASS"
    $Message = "Mocha AE exact effect apply, structural readback, exact project restore, and warm-process reuse passed."
  } elseif ($null -ne $RestoreFailure) { $Message = $RestoreFailure }
  elseif ($null -ne $PrimaryFailure) { $Message = $PrimaryFailure }
  elseif (-not $SameAeProcess) { $Message = "After Effects process identity changed during Mocha apply proof." }
  $Measured = @($SourceMs,$EnterMs,$ApplyMs,$RestoreMs) | Where-Object { $null -ne $_ }
  $MaxRoundtripMs = if ($Measured.Count) { [Math]::Round(($Measured | Measure-Object -Maximum).Maximum, 3) } else { $null }
  $Result = [ordered]@{
    proofId = "M5_MOCHA_AE_APPLY_REAL_AE_V1"; classification = $Classification; ok = ($Classification -eq "PASS")
    mutationStarted = $MutationStarted; cleanupComplete = $CleanupComplete; message = $Message
    baselineAePids = $BaselinePids; afterAePids = $AfterPids; sameAeProcess = $SameAeProcess
    restoreAttempted = $RestoreAttempted; primaryFailure = $PrimaryFailure; restoreFailure = $RestoreFailure
    sourceProbeRoundtripMs = $SourceMs; isolationEnterRoundtripMs = $EnterMs; effectApplyRoundtripMs = $ApplyMs; restoreRoundtripMs = $RestoreMs
    maxMeasuredWarmAeRoundtripMs = $MaxRoundtripMs
    source = $Source; enter = $Enter; fixture = $Fixture; restore = $Restore
  }
  [IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 40) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Apply roundtrip: " + $ApplyMs + " ms; max measured warm roundtrip: " + $MaxRoundtripMs + " ms")
