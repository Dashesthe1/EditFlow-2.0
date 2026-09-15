param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-exit-gate-semantic-attach" }
$PlanScript = Join-Path $RepoRoot "scripts\m4-exit-gate-semantic-attach-plan.mjs"
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-exit-gate-semantic-attach-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v25.jsx"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-real-ae-proof.jsx"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "M4 exit-gate semantic-attach proof did not complete."
$HostResult = $null
$VisualEvidence = @()
$VisualCheckpointPassed = $false
$AeProcessReused = $false
$BaselineAePids = @()
$AfterAePids = @()
$ProofPlan = $null
try {
  foreach ($Required in @($AfterFxPath, $PlanScript, $TemplatePath, $HostLoaderPath)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required proof file missing: $Required" }
  }
  $BaselineAePids = @(Get-Process -Name AfterFX -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  if ($BaselineAePids.Count -eq 0) { throw "REUSE_AE proof requires an already-running After Effects process." }
  Remove-Item $HostResultPath, $ResultPath, $RunScriptPath -Force -ErrorAction SilentlyContinue
  Get-ChildItem $ArtifactDir -Filter '*.png' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

  Push-Location $RepoRoot
  try {
    $Classification = "PRODUCT_FAILURE"
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) {
      throw "M4 exit-gate semantic-attach plan generation failed."
    }
  } finally { Pop-Location }
  $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json

  $Template = [System.IO.File]::ReadAllText($TemplatePath)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_PLAN_PATH__", (& $ForJs $PlanPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_LOADER__", (& $ForJs $HostLoaderPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)
  $Classification = "INFRASTRUCTURE_FAILURE"
  $BatchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r', $RunScriptPath) -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) {
    throw "Timed out waiting for the warm AE M4 exit-gate result."
  }
  $ReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReadDeadline -and $null -eq $HostResult) {
    try {
      $Candidate = Get-Content $HostResultPath -Raw | ConvertFrom-Json
      if ($Candidate -and $Candidate.proofId -eq "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE") { $HostResult = $Candidate }
    } catch { $HostResult = $null }
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 25 }
  }
  $BatchStopwatch.Stop()
  if ($null -eq $HostResult) { throw "M4 exit-gate host result was not valid JSON." }
  $AfterAePids = @(Get-Process -Name AfterFX -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  $AeProcessReused = (($BaselineAePids -join ',') -eq ($AfterAePids -join ','))
  if (-not $AeProcessReused) { throw "Warm proof changed the persistent After Effects process set." }
  $Classification = "PRODUCT_FAILURE"
  if ($HostResult.ok -ne $true) { throw ("Host proof failed: " + [string]$HostResult.failure) }
  if (@($HostResult.fixtureResults).Count -ne 2) { throw "Host proof did not return both transfer fixtures." }
  $ReviewDeadline = (Get-Date).AddSeconds(5)
  do {
    $MissingReviews = @($HostResult.reviewFiles | Where-Object { -not (Test-Path $_ -PathType Leaf) -or (Get-Item $_).Length -eq 0 })
    if ($MissingReviews.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $ReviewDeadline)
  if ($MissingReviews.Count -ne 0) { throw ("Review frames did not become ready: " + ($MissingReviews -join ", ")) }
  Add-Type -AssemblyName System.Drawing
  function Get-MagentaProbe([System.Drawing.Bitmap]$Bitmap, [int]$X, [int]$Y) {
    $Best = $null; $BestScore = -100000
    for ($Dy = -4; $Dy -le 4; $Dy++) {
      for ($Dx = -4; $Dx -le 4; $Dx++) {
        $Px = [Math]::Max(0, [Math]::Min($Bitmap.Width - 1, $X + $Dx))
        $Py = [Math]::Max(0, [Math]::Min($Bitmap.Height - 1, $Y + $Dy))
        $P = $Bitmap.GetPixel($Px, $Py)
        $Score = [int]$P.R + [int]$P.B - (2 * [int]$P.G)
        if ($Score -gt $BestScore) { $BestScore = $Score; $Best = $P }
      }
    }
    return [ordered]@{ r=$Best.R; g=$Best.G; b=$Best.B; score=$BestScore; pass=($Best.R -ge 150 -and $Best.B -ge 120 -and $BestScore -ge 120) }
  }
  function Test-Blue([System.Drawing.Color]$P) {
    return ($P.B -ge 100 -and $P.B -ge ($P.R + 60) -and $P.B -ge ($P.G + 45))
  }
  function Color-Distance([System.Drawing.Color]$A, [System.Drawing.Color]$B) {
    return [Math]::Abs([int]$A.R-[int]$B.R)+[Math]::Abs([int]$A.G-[int]$B.G)+[Math]::Abs([int]$A.B-[int]$B.B)
  }
  $AllVisualPass = $true
  for ($Fi = 0; $Fi -lt $ProofPlan.fixtures.Count; $Fi++) {
    $FixturePlan = $ProofPlan.fixtures[$Fi]
    $FixtureHost = $HostResult.fixtureResults[$Fi]
    $Radius = [int][Math]::Round([double]$FixtureHost.markerRadius)
    for ($Si = 0; $Si -lt $FixturePlan.sampleIndices.Count; $Si++) {
      $FrameIndex = [int]$FixturePlan.sampleIndices[$Si]
      $Path = [string]$FixtureHost.finalFramePaths[$Si]
      if (-not (Test-Path $Path -PathType Leaf)) { throw "Missing review frame: $Path" }
      $Attach = $FixturePlan.attachFrames[$FrameIndex].resolution.pointCompPx
      $Bitmap = [System.Drawing.Bitmap]::FromFile($Path)
      try {
        $Cx = [int][Math]::Round([double]$Attach[0]); $Cy = [int][Math]::Round([double]$Attach[1])
        $BgX = [int]$FixturePlan.backgroundSample.x; $BgY = [int]$FixturePlan.backgroundSample.y
        $CenterPixel = $Bitmap.GetPixel($Cx, $Cy); $BgPixel = $Bitmap.GetPixel($BgX, $BgY)
        $Ring = Get-MagentaProbe $Bitmap ([Math]::Min($Bitmap.Width-1,$Cx+$Radius)) $Cy
        $BgPass = Test-Blue $BgPixel
        $SubjectPass = (Color-Distance $CenterPixel $BgPixel) -ge 70
        $DimensionsPass = $Bitmap.Width -eq [int]$FixturePlan.width -and $Bitmap.Height -eq [int]$FixturePlan.height
        $FramePass = $DimensionsPass -and $BgPass -and $SubjectPass -and $Ring.pass
        $VisualEvidence += [ordered]@{
          kind='FINAL_ATTACH'; fixtureId=$FixturePlan.fixtureId; frameIndex=$FrameIndex; path=$Path; pass=$FramePass;
          dimensionsPass=$DimensionsPass; backgroundPass=$BgPass; subjectInteriorPass=$SubjectPass; ring=$Ring;
          center=[ordered]@{x=$Cx;y=$Cy;r=$CenterPixel.R;g=$CenterPixel.G;b=$CenterPixel.B};
          background=[ordered]@{x=$BgX;y=$BgY;r=$BgPixel.R;g=$BgPixel.G;b=$BgPixel.B}
        }
        $AllVisualPass = $AllVisualPass -and $FramePass
      } finally { $Bitmap.Dispose() }
    }
  }
  $RepairPlan = $ProofPlan.fixtures[0].repair
  $RepairHost = $HostResult.fixtureResults[0]
  $RepairPass = $false
  if ($RepairPlan -and $RepairHost.driftFramePath -and $RepairHost.repairedFramePath) {
    $DriftBitmap = [System.Drawing.Bitmap]::FromFile([string]$RepairHost.driftFramePath)
    $FixedBitmap = [System.Drawing.Bitmap]::FromFile([string]$RepairHost.repairedFramePath)
    try {
      $Radius = [int][Math]::Round([double]$RepairHost.markerRadius)
      $Wx = [int][Math]::Round([double]$RepairPlan.wrongPointPx[0]); $Wy = [int][Math]::Round([double]$RepairPlan.wrongPointPx[1])
      $Cx = [int][Math]::Round([double]$RepairPlan.correctPointPx[0]); $Cy = [int][Math]::Round([double]$RepairPlan.correctPointPx[1])
      $DriftWrong = Get-MagentaProbe $DriftBitmap ([Math]::Min($DriftBitmap.Width-1,$Wx+$Radius)) $Wy
      $DriftCorrect = Get-MagentaProbe $DriftBitmap ([Math]::Min($DriftBitmap.Width-1,$Cx+$Radius)) $Cy
      $FixedCorrect = Get-MagentaProbe $FixedBitmap ([Math]::Min($FixedBitmap.Width-1,$Cx+$Radius)) $Cy
      $FixedWrong = Get-MagentaProbe $FixedBitmap ([Math]::Min($FixedBitmap.Width-1,$Wx+$Radius)) $Wy
      $HashesDiffer = (Get-FileHash $RepairHost.driftFramePath -Algorithm SHA256).Hash -ne (Get-FileHash $RepairHost.repairedFramePath -Algorithm SHA256).Hash
      $RepairPass = $DriftWrong.pass -and (-not $DriftCorrect.pass) -and $FixedCorrect.pass -and (-not $FixedWrong.pass) -and $HashesDiffer
      $VisualEvidence += [ordered]@{
        kind='VISIBLE_REPAIR'; fixtureId=$ProofPlan.fixtures[0].fixtureId; frameIndex=[int]$RepairPlan.frameIndex; pass=$RepairPass;
        driftFrame=$RepairHost.driftFramePath; repairedFrame=$RepairHost.repairedFramePath; hashesDiffer=$HashesDiffer;
        driftWrong=$DriftWrong; driftCorrect=$DriftCorrect; repairedCorrect=$FixedCorrect; repairedWrong=$FixedWrong
      }
      $AllVisualPass = $AllVisualPass -and $RepairPass
    } finally { $DriftBitmap.Dispose(); $FixedBitmap.Dispose() }
  }
  $VisualCheckpointPassed = $AllVisualPass -and $RepairPass
  $RoutineTimings = @($HostResult.dispatchTimingsMs | Where-Object {
    $_.gapFromPreviousMs -ne $null -and $_.command -ne 'media.import' -and $_.command -ne 'media.sequence.readback' -and $_.command -ne 'layer.composite_readback'
  })
  $RoutineGaps = @($RoutineTimings | ForEach-Object { [double]$_.gapFromPreviousMs })
  $DispatchDurations = @($HostResult.dispatchTimingsMs | ForEach-Object { [double]$_.durationMs })
  $MaxRoutineGapMs = if ($RoutineGaps.Count) { ($RoutineGaps | Measure-Object -Maximum).Maximum } else { $null }
  $MeanRoutineGapMs = if ($RoutineGaps.Count) { ($RoutineGaps | Measure-Object -Average).Average } else { $null }
  $MaxDispatchDurationMs = if ($DispatchDurations.Count) { ($DispatchDurations | Measure-Object -Maximum).Maximum } else { $null }
  if ($HostResult.ok -eq $true -and $HostResult.cleanupComplete -eq $true -and $VisualCheckpointPassed -and $AeProcessReused) {
    $Classification = "PASS"
    $Message = "M4 exit gate passed: moving subjects isolated, semantic construction attached, visible drift repaired, and transfer accepted on unrelated footage."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "M4 exit-gate semantic-attach checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $BatchDurationMs = if ($BatchStopwatch) { [double]$BatchStopwatch.Elapsed.TotalMilliseconds } else { $null }
  $Result = [ordered]@{
    proofId = "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    cleanupComplete = if ($HostResult) { [bool]$HostResult.cleanupComplete } else { $false }
    visualCheckpointPassed = $VisualCheckpointPassed
    aeProcessReused = $AeProcessReused
    baselineAePids = $BaselineAePids
    afterAePids = $AfterAePids
    visualEvidence = $VisualEvidence
    fastPathMetrics = [ordered]@{
      batchDurationMs = $BatchDurationMs
      dispatchCount = if ($HostResult) { @($HostResult.dispatchTimingsMs).Count } else { 0 }
      maxRoutineGapMs = $MaxRoutineGapMs
      meanRoutineGapMs = $MeanRoutineGapMs
      maxDispatchDurationMs = $MaxDispatchDurationMs
      dispatchTimingsMs = if ($HostResult) { $HostResult.dispatchTimingsMs } else { @() }
    }
    message = $Message
    planGates = if ($ProofPlan) { $ProofPlan.gates } else { $null }
    hostResult = $HostResult
    artifacts = [ordered]@{ plan=$PlanPath; hostResult=$HostResultPath; generatedScript=$RunScriptPath }
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 64) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Fast-path max routine gap: " + $MaxRoutineGapMs + " ms")
Write-Host ("Fast-path mean routine gap: " + $MeanRoutineGapMs + " ms")
