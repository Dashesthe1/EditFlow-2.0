param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 12
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnterScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-isolation-enter.jsx"
$RestoreScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-isolation-restore.jsx"
$PreflightRunner = Join-Path $RepoRoot "scripts\windows\run-m5-roto-brush-proof-preflight.ps1"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m5-roto-brush-isolation-roundtrip"
$ResultPath = Join-Path $ArtifactDir "result.json"
$StatePath = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-state.json"
$EnterMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-enter.json"
$RestoreMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-restore.json"
$PreflightMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-preflight.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
function Wait-JsonMarker([string]$Path, [int]$Seconds, [string]$Label) {
  $Deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $Path -PathType Leaf)) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $Path -PathType Leaf)) { throw "$Label timed out waiting for $Path" }
  $ReadDeadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $ReadDeadline) {
    try { return Get-Content $Path -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 50 }
  }
  throw "$Label marker was not valid JSON: $Path"
}
function Invoke-AeScript([string]$ScriptPath) {
  if (-not (Test-Path $ScriptPath -PathType Leaf)) { throw "Required AE script missing: $ScriptPath" }
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $ScriptPath) -PassThru)
}
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "M5 Roto Brush isolation roundtrip did not complete."
$Enter = $null; $Preflight = $null; $Restore = $null
$BaselinePids = @(); $AfterPids = @(); $SameAeProcess = $false
$RestoreAttempted = $false; $PrimaryFailure = $null; $RestoreFailure = $null
try {
  foreach ($Required in @($AfterFxPath, $EnterScript, $RestoreScript, $PreflightRunner)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required roundtrip file missing: $Required" }
  }
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -ne 1) { throw "M5 isolation requires exactly one already-running After Effects process; found $($Running.Count)." }
  if (-not $Running[0].Responding -or $Running[0].MainWindowHandle -eq 0) { throw "The existing After Effects process is not a responsive visible target." }
  $BaselinePids = @($Running | ForEach-Object { $_.Id } | Sort-Object)
  Remove-Item $StatePath, $EnterMarker, $RestoreMarker, $PreflightMarker -Force -ErrorAction SilentlyContinue
  Invoke-AeScript $EnterScript
  $Enter = Wait-JsonMarker $EnterMarker $TimeoutSeconds "M5 isolation entry"
  if ($Enter.version -ne "M5_ROTO_BRUSH_ISOLATION_V1" -or $Enter.ok -ne $true) {
    throw "M5 isolation entry refused: $($Enter.failure)"
  }
  $Classification = "PRODUCT_FAILURE"
  $PreflightText = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PreflightRunner -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw "M5 blank-project preflight failed." }
  $Preflight = $PreflightText | ConvertFrom-Json
  if ($Preflight.eligible -ne $true -or $Preflight.safeToIssueInteractiveActions -ne $true) { throw "M5 preflight did not authorize the isolation project." }
} catch {
  $PrimaryFailure = $_.Exception.Message
} finally {
  if (Test-Path $StatePath -PathType Leaf) {
    $RestoreAttempted = $true
    try {
      Remove-Item $RestoreMarker -Force -ErrorAction SilentlyContinue
      Invoke-AeScript $RestoreScript
      $Restore = Wait-JsonMarker $RestoreMarker $TimeoutSeconds "M5 isolation restore"
      if ($Restore.version -ne "M5_ROTO_BRUSH_ISOLATION_V1" -or $Restore.ok -ne $true) {
        throw "M5 isolation restore refused: $($Restore.failure)"
      }
    } catch { $RestoreFailure = $_.Exception.Message }
  }
  $AfterPids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  $SameAeProcess = (($BaselinePids -join ',') -eq ($AfterPids -join ',')) -and $BaselinePids.Count -eq 1
  if ($null -eq $PrimaryFailure -and $null -eq $RestoreFailure -and $RestoreAttempted -and $Restore.ok -eq $true -and $SameAeProcess) {
    $Classification = "PASS"
    $Message = "M5 warm-AE isolation, blank-project preflight, exact project restore, and process reuse passed."
  } else {
    if ($null -ne $RestoreFailure) { $Message = $RestoreFailure }
    elseif ($null -ne $PrimaryFailure) { $Message = $PrimaryFailure }
    elseif (-not $SameAeProcess) { $Message = "After Effects process identity changed during M5 isolation roundtrip." }
    else { $Message = "M5 isolation roundtrip did not satisfy all restoration gates." }
  }
  $Result = [ordered]@{
    proofId = "M5_ROTO_BRUSH_ISOLATION_ROUNDTRIP_V1"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    baselineAePids = $BaselinePids
    afterAePids = $AfterPids
    sameAeProcess = $SameAeProcess
    restoreAttempted = $RestoreAttempted
    primaryFailure = $PrimaryFailure
    restoreFailure = $RestoreFailure
    enter = $Enter
    preflight = $Preflight
    restore = $Restore
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 32) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
