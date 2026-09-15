param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-sam31-live-sequence-matte-e2e" }
$RunId = if ($env:EDITFLOW_PROOF_RUN_ID) { $env:EDITFLOW_PROOF_RUN_ID } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
$env:EDITFLOW_PROOF_RUN_ID = $RunId
$env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-sam31-live-sequence-matte-e2e-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v25.jsx"
$PlanScript = Join-Path $RepoRoot "scripts\m4-sam31-live-sequence-matte-e2e-proof-plan.mjs"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-sequence-materialization-proof.jsx"
$ReviewPaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("sam31-e2e-review-{0}.png" -f $_) })
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Live SAM 3.1 sequence-matte E2E proof did not complete."
$HostResult = $null
$VisualEvidence = @()
$VisualCheckpointPassed = $false
$AeProcessReused = $false
$BaselineAePids = @()
$AfterAePids = @()
$ReviewHashes = @()
$ProofPlan = $null
try {
  foreach ($Required in @($AfterFxPath, $TemplatePath, $HostLoaderPath, $PlanScript)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required proof file missing: $Required" }
  }
  $BaselineAePids = @(Get-Process -Name AfterFX -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  if ($BaselineAePids.Count -eq 0) { throw "REUSE_AE proof requires an already-running After Effects process." }
  Remove-Item $PlanPath, $HostResultPath, $ResultPath, $RunScriptPath -Force -ErrorAction SilentlyContinue
  foreach ($ReviewPath in $ReviewPaths) { Remove-Item $ReviewPath -Force -ErrorAction SilentlyContinue }

  Push-Location $RepoRoot
  try {
    $Classification = "PRODUCT_FAILURE"
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) {
      throw "Temporal materialization proof-plan generation failed."
    }
  } finally { Pop-Location }

  $Template = [System.IO.File]::ReadAllText($TemplatePath)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_PLAN_PATH__", (& $ForJs $PlanPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_LOADER__", (& $ForJs $HostLoaderPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  for ($Index = 0; $Index -lt 3; $Index++) {
    $Generated = $Generated.Replace(("__EDITFLOW_REVIEW_FRAME_{0}__" -f $Index), (& $ForJs $ReviewPaths[$Index]))
  }
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "INFRASTRUCTURE_FAILURE"
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r', $RunScriptPath) -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) {
    throw "Timed out waiting for the warm AE dynamic materialization result."
  }
  $ReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReadDeadline -and $null -eq $HostResult) {
    try {
      $Candidate = Get-Content $HostResultPath -Raw | ConvertFrom-Json
      if ($Candidate -and $Candidate.proofId -eq "M4_SAM31_LIVE_SEQUENCE_MATTE_E2E_REAL_AE") {
        $HostResult = $Candidate
      }
    } catch { $HostResult = $null }
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Dynamic materialization host result was not valid JSON." }
  Start-Sleep -Milliseconds 250
  $AfterAePids = @(Get-Process -Name AfterFX -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
  $AeProcessReused = (($BaselineAePids -join ',') -eq ($AfterAePids -join ','))
  if (-not $AeProcessReused) { throw "Warm proof changed the persistent After Effects process set." }

  $ReviewDeadline = (Get-Date).AddSeconds(5)
  do {
    $Missing = @($ReviewPaths | Where-Object { -not (Test-Path $_ -PathType Leaf) })
    if ($Missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $ReviewDeadline)
  if ($Missing.Count -ne 0) { throw "One or more temporal review frames were not emitted." }

  Add-Type -AssemblyName System.Drawing
  $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json
  $AllFramesPass = $true
  for ($Index = 0; $Index -lt 3; $Index++) {
    $Bitmap = [System.Drawing.Bitmap]::FromFile($ReviewPaths[$Index])
    try {
      $Expectation = $ProofPlan.visualExpectations.frames[$Index]
      $DimensionsPass = $Bitmap.Width -eq [int]$ProofPlan.fixtures.width -and $Bitmap.Height -eq [int]$ProofPlan.fixtures.height
      $Fg = $Expectation.foregroundSample
      $FgPixel = $Bitmap.GetPixel([int]$Fg.x, [int]$Fg.y)
      $FgPass = $FgPixel.R -ge 200 -and $FgPixel.R -gt $FgPixel.G -and $FgPixel.G -le 130 -and $FgPixel.B -le 100
      $Bg = $ProofPlan.visualExpectations.backgroundSample
      $BgPixel = $Bitmap.GetPixel([int]$Bg.x, [int]$Bg.y)
      $BgPass = $BgPixel.B -ge 60 -and $BgPixel.B -gt $BgPixel.G -and $BgPixel.G -gt $BgPixel.R
      $FramePass = $DimensionsPass -and $FgPass -and $BgPass
      $VisualEvidence += [ordered]@{
        reviewIndex=$Index; sourceFrameIndex=[int]$Expectation.frameIndex; path=$ReviewPaths[$Index]; dimensionsPass=$DimensionsPass;
        foreground=[ordered]@{x=[int]$Fg.x;y=[int]$Fg.y;r=$FgPixel.R;g=$FgPixel.G;b=$FgPixel.B;pass=$FgPass};
        background=[ordered]@{x=[int]$Bg.x;y=[int]$Bg.y;r=$BgPixel.R;g=$BgPixel.G;b=$BgPixel.B;pass=$BgPass}; pass=$FramePass
      }
      $AllFramesPass = $AllFramesPass -and $FramePass
    } finally { $Bitmap.Dispose() }
  }
  $ReviewHashes = @($ReviewPaths | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant() })
  $DynamicFramesPass = @($ReviewHashes | Select-Object -Unique).Count -eq 3
  $VisualCheckpointPassed = $AllFramesPass -and $DynamicFramesPass
  if ($HostResult.ok -eq $true -and $HostResult.cleanupComplete -eq $true -and $VisualCheckpointPassed -and $AeProcessReused) {
    $Classification = "PASS"
    $Message = "Live SAM 3.1 sequence -> planner -> native AE sequence matte, dynamic visual proof, warm-AE reuse, and scoped cleanup passed."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "Live SAM 3.1 E2E temporal materialization checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_SAM31_LIVE_SEQUENCE_MATTE_E2E_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    cleanupComplete = if ($HostResult) { [bool]$HostResult.cleanupComplete } else { $false }
    visualCheckpointPassed = $VisualCheckpointPassed
    visualEvidence = $VisualEvidence
    reviewFrameSha256 = $ReviewHashes
    aeProcessReused = $AeProcessReused
    baselineAePids = $BaselineAePids
    afterAePids = $AfterAePids
    sam31Evidence = if ($ProofPlan) { $ProofPlan.sam31 } else { $null }
    message = $Message
    hostResult = $HostResult
    artifacts = [ordered]@{ plan=$PlanPath; hostResult=$HostResultPath; reviewFrames=$ReviewPaths; generatedScript=$RunScriptPath }
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 64) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Review frames: " + ($ReviewPaths -join ", "))