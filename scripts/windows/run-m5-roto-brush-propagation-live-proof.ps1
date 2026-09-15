param(
  [ValidateSet("FORWARD","BACKWARD")]
  [string]$Direction = "FORWARD",
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [string]$SourcePath = "C:\Users\Shadow\Downloads\Main Clips\Peter Parker - The Amazing Spider-Man [2012] - [REMUX 4K HEVC-H265] - chaszq-00.51.24.562-00.51.42.047.mp4",
  [int]$TimeoutSeconds = 20
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnterScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-isolation-enter.jsx"
$RestoreScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-isolation-restore.jsx"
$PreflightRunner = Join-Path $RepoRoot "scripts\windows\run-m5-roto-brush-proof-preflight.ps1"
$FixtureScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-fixture-setup.jsx"
$ReadbackScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-readback-dispatch.jsx"
$NodeProof = Join-Path $RepoRoot "scripts\m5-roto-brush-propagation-live-proof.mjs"
$PythonPath = "C:\Users\Shadow\editgpt\.venv\Scripts\python.exe"
$SeedVisualScript = Join-Path $RepoRoot "packages\adapters\ae-cep\runtime\editgpt_roto_brush_seed_visual_driver.py"
$PropagationVisualScript = Join-Path $RepoRoot "packages\adapters\ae-cep\runtime\editgpt_roto_brush_propagation_visual_driver.py"
$VisualWorkdir = Join-Path $RepoRoot "packages\adapters\ae-cep\runtime"
$ArtifactDirName = "m5-roto-brush-propagation-" + $Direction.ToLowerInvariant() + "-live-proof"
$ArtifactDir = Join-Path $RepoRoot ("proofs\artifacts\" + $ArtifactDirName)
$EvidenceDir = Join-Path $ArtifactDir "visual-evidence"
$LiveResultPath = Join-Path $ArtifactDir "live-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$StatePath = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-state.json"
$EnterMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-enter.json"
$RestoreMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-isolation-restore.json"
$FixtureInput = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-fixture-input.json"
$FixtureMarker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-fixture-result.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir, $EvidenceDir | Out-Null
function Wait-JsonMarker([string]$Path, [int]$Seconds, [string]$Label) {
  $Deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $Path -PathType Leaf)) { Start-Sleep -Milliseconds 50 }
  if (-not (Test-Path $Path -PathType Leaf)) { throw "$Label timed out waiting for $Path" }
  $ReadDeadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $ReadDeadline) {
    try { return Get-Content $Path -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 25 }
  }
  throw "$Label marker was not valid JSON: $Path"
}
function Invoke-AeScript([string]$ScriptPath) {
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $ScriptPath) -PassThru)
}
function Test-LocalPort([int]$Port) {
  $Client = New-Object System.Net.Sockets.TcpClient
  try {
    $Task = $Client.ConnectAsync("127.0.0.1", $Port)
    return $Task.Wait(600) -and $Client.Connected
  } catch { return $false } finally { $Client.Dispose() }
}
function Test-SemanticReady {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080/v1/models" -TimeoutSec 2).StatusCode -eq 200 }
  catch { return $false }
}
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = ("M5 Roto Brush live " + $Direction.ToLowerInvariant() + " propagation proof did not complete.")
$BaselineAePids = @(); $AfterAePids = @(); $SameAeProcess = $false
$Enter = $null; $Fixture = $null; $Live = $null; $Restore = $null
$PrimaryFailure = $null; $RestoreFailure = $null; $RestoreAttempted = $false
try {
  foreach ($Required in @($AfterFxPath,$SourcePath,$EnterScript,$RestoreScript,$PreflightRunner,$FixtureScript,$ReadbackScript,$NodeProof,$PythonPath,$SeedVisualScript,$PropagationVisualScript)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "Required M5 live-proof file missing: $Required" }
  }
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -ne 1) { throw "M5 Roto Brush live proof requires exactly one already-running After Effects process; found $($Running.Count)." }
  if (-not $Running[0].Responding -or $Running[0].MainWindowHandle -eq 0) { throw "The current After Effects process is not a responsive visible proof target." }
  $BaselineAePids = @($Running | ForEach-Object { $_.Id } | Sort-Object)
  if (-not (Test-LocalPort 8765) -or -not (Test-LocalPort 8766)) { throw "EditGPT Eyes/Hands MCP sidecars are not ready on loopback." }
  if (-not (Test-SemanticReady)) { throw "EditGPT local Qwen semantic verifier is not ready; no AE proof mutation was attempted." }
  Remove-Item $LiveResultPath,$ResultPath,$StatePath,$EnterMarker,$RestoreMarker,$FixtureInput,$FixtureMarker -Force -ErrorAction SilentlyContinue
  Invoke-AeScript $EnterScript
  $Enter = Wait-JsonMarker $EnterMarker $TimeoutSeconds "M5 isolation entry"
  if ($Enter.version -ne "M5_ROTO_BRUSH_ISOLATION_V1" -or $Enter.ok -ne $true) { throw "M5 isolation entry refused: $($Enter.failure)" }
  $Classification = "PRODUCT_FAILURE"
  $PreflightText = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PreflightRunner -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw "M5 blank-project preflight failed." }
  $Preflight = $PreflightText | ConvertFrom-Json
  if ($Preflight.eligible -ne $true -or $Preflight.safeToIssueInteractiveActions -ne $true) { throw "M5 preflight did not authorize the isolation project." }
  $FixtureRequest = [ordered]@{ sourcePath=$SourcePath; compName="EF2_M5_ROTO_PROOF_COMP"; layerName="EF2_M5_ROTO_SUBJECT"; atTime=0.5 }
  [System.IO.File]::WriteAllText($FixtureInput, (($FixtureRequest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $Utf8NoBom)
  Invoke-AeScript $FixtureScript
  $Fixture = Wait-JsonMarker $FixtureMarker $TimeoutSeconds "M5 Roto Brush fixture setup"
  if ($Fixture.ok -ne $true) { throw "M5 Roto Brush fixture setup failed: $($Fixture.failure)" }
  Push-Location $RepoRoot
  try {
    & node $NodeProof `
      --afterfx-path $AfterFxPath `
      --fixture $FixtureMarker `
      --result $LiveResultPath `
      --readback-script $ReadbackScript `
      --python $PythonPath `
      --seed-visual-script $SeedVisualScript `
      --propagation-visual-script $PropagationVisualScript `
      --visual-workdir $VisualWorkdir `
      --evidence-dir $EvidenceDir `
      --direction $Direction `
      --timeout-ms ($TimeoutSeconds * 1000)
    $NodeExit = $LASTEXITCODE
  } finally { Pop-Location }
  if (-not (Test-Path $LiveResultPath -PathType Leaf)) { throw "M5 live controller exited without a result (exit $NodeExit)." }
  $Live = Get-Content $LiveResultPath -Raw | ConvertFrom-Json
  if ($Live.proofId -ne ("M5_ROTO_BRUSH_PROPAGATION_" + $Direction + "_REAL_AE_V1")) { throw "Unexpected M5 live proof result identity." }
  if ($NodeExit -ne 0 -or $Live.ok -ne $true) {
    $Reason = if ($Live.failure) { [string]$Live.failure } else { "M5 guarded live propagation controller failed." }
    throw $Reason
  }
} catch {
  $PrimaryFailure = $_.Exception.Message
} finally {
  if (Test-Path $StatePath -PathType Leaf) {
    $RestoreAttempted = $true
    try {
      Remove-Item $RestoreMarker -Force -ErrorAction SilentlyContinue
      Invoke-AeScript $RestoreScript
      $Restore = Wait-JsonMarker $RestoreMarker $TimeoutSeconds "M5 isolation restore"
      if ($Restore.version -ne "M5_ROTO_BRUSH_ISOLATION_V1" -or $Restore.ok -ne $true) { throw "M5 isolation restore refused: $($Restore.failure)" }
    } catch { $RestoreFailure = $_.Exception.Message }
  }
  $AfterAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  $SameAeProcess = (($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
  if ($null -eq $PrimaryFailure -and $null -eq $RestoreFailure -and $Live -and $Live.ok -eq $true -and $RestoreAttempted -and $Restore.ok -eq $true -and $SameAeProcess) {
    $Classification = "PASS"
    $Message = ("M5 live Roto Brush " + $Direction.ToLowerInvariant() + " propagation passed with bounded frame stepping, retained segmentation evidence, exact restore, and one warm AE process.")
  } else {
    if ($null -ne $RestoreFailure) { $Message = $RestoreFailure }
    elseif ($null -ne $PrimaryFailure) { $Message = $PrimaryFailure }
    elseif (-not $SameAeProcess) { $Message = "After Effects process identity changed during the M5 live proof." }
    else { $Message = "M5 live proof did not satisfy all retained gates." }
  }
  $Result = [ordered]@{
    proofId = ("M5_ROTO_BRUSH_PROPAGATION_" + $Direction + "_RETAINED_REAL_AE_V1")
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    baselineAePids = $BaselineAePids
    afterAePids = $AfterAePids
    sameAeProcess = $SameAeProcess
    restoreAttempted = $RestoreAttempted
    primaryFailure = $PrimaryFailure
    restoreFailure = $RestoreFailure
    isolation = $Enter
    fixture = $Fixture
    live = $Live
    restore = $Restore
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 80) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
if ($Live -and $Live.speed) { Write-Host ("Max measured AE action gap: " + $Live.speed.maxAeActionGapMs + " ms") }
