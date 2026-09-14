param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$SourceHostId = 13,
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-segmentation-sequence-transfer" }
$RunId = if ($env:EDITFLOW_PROOF_RUN_ID) { $env:EDITFLOW_PROOF_RUN_ID } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
$env:EDITFLOW_PROOF_RUN_ID = $RunId
$env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
$env:EDITFLOW_M4_TRANSFER_SOURCE_HOST_ID = $SourceHostId.ToString()
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-segmentation-sequence-transfer-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v25.jsx"
$PlanScript = Join-Path $RepoRoot "scripts\m4-segmentation-sequence-transfer-proof-plan.mjs"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-sequence-transfer-proof.jsx"
$BaselinePaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("transfer-baseline-{0}.png" -f $_) })
$ReviewPaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("transfer-review-{0}.png" -f $_) })
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Segmentation sequence transfer proof did not complete."
$HostResult = $null
$VisualEvidence = @()
$VisualCheckpointPassed = $false

function Near-Color([System.Drawing.Color]$A, [System.Drawing.Color]$B, [int]$Tolerance = 12) {
  return ([Math]::Abs([int]$A.R - [int]$B.R) -le $Tolerance) -and
    ([Math]::Abs([int]$A.G - [int]$B.G) -le $Tolerance) -and
    ([Math]::Abs([int]$A.B - [int]$B.B) -le $Tolerance)
}

try {
  foreach ($Required in @($AfterFxPath, $TemplatePath, $HostLoaderPath, $PlanScript)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required transfer proof file missing: $Required" }
  }
  Remove-Item $PlanPath, $HostResultPath, $ResultPath, $RunScriptPath -Force -ErrorAction SilentlyContinue
  foreach ($Path in @($BaselinePaths + $ReviewPaths)) { Remove-Item $Path -Force -ErrorAction SilentlyContinue }

  Push-Location $RepoRoot
  try {
    $Classification = "PRODUCT_FAILURE"
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) { throw "Transfer proof-plan generation failed." }
  } finally { Pop-Location }

  $Template = [System.IO.File]::ReadAllText($TemplatePath)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_PLAN_PATH__", (& $ForJs $PlanPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_LOADER__", (& $ForJs $HostLoaderPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  for ($Index = 0; $Index -lt 3; $Index++) {
    $Generated = $Generated.Replace(("__EDITFLOW_BASELINE_FRAME_{0}__" -f $Index), (& $ForJs $BaselinePaths[$Index]))
    $Generated = $Generated.Replace(("__EDITFLOW_REVIEW_FRAME_{0}__" -f $Index), (& $ForJs $ReviewPaths[$Index]))
  }
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "INFRASTRUCTURE_FAILURE"
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r', $RunScriptPath) -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) { throw "Timed out waiting for warm-AE transfer result." }
  $ReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReadDeadline -and $null -eq $HostResult) {
    try {
      $Candidate = Get-Content $HostResultPath -Raw | ConvertFrom-Json
      if ($Candidate -and $Candidate.proofId -eq "M4_SEGMENTATION_SEQUENCE_TRANSFER_REAL_AE") { $HostResult = $Candidate }
    } catch { $HostResult = $null }
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Transfer host result was not valid JSON." }

  $FrameDeadline = (Get-Date).AddSeconds(8)
  do {
    $Missing = @(@($BaselinePaths + $ReviewPaths) | Where-Object { -not (Test-Path $_ -PathType Leaf) })
    if ($Missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $FrameDeadline)
  if ($Missing.Count -ne 0) { throw "One or more transfer review frames were not emitted." }

  Add-Type -AssemblyName System.Drawing
  $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json
  $Bg = [System.Drawing.Color]::FromArgb(255, [int]$ProofPlan.fixtures.backgroundRgb[0], [int]$ProofPlan.fixtures.backgroundRgb[1], [int]$ProofPlan.fixtures.backgroundRgb[2])
  $AllFramesPass = $true
  for ($Index = 0; $Index -lt 3; $Index++) {
    $Baseline = [System.Drawing.Bitmap]::FromFile($BaselinePaths[$Index])
    $Review = [System.Drawing.Bitmap]::FromFile($ReviewPaths[$Index])
    try {
      $DimensionsPass = $Baseline.Width -eq [int]$ProofPlan.fixtures.compWidth -and $Baseline.Height -eq [int]$ProofPlan.fixtures.compHeight -and
        $Review.Width -eq [int]$ProofPlan.fixtures.compWidth -and $Review.Height -eq [int]$ProofPlan.fixtures.compHeight
      $Samples = @()
      $FramePass = $DimensionsPass
      for ($SampleIndex = 0; $SampleIndex -lt 3; $SampleIndex++) {
        $Sample = $ProofPlan.visualExpectations.subjectSamples[$SampleIndex]
        $BasePixel = $Baseline.GetPixel([int]$Sample.x, [int]$Sample.y)
        $OutPixel = $Review.GetPixel([int]$Sample.x, [int]$Sample.y)
        if ($SampleIndex -eq $Index) {
          $BaselineIsDistinct = -not (Near-Color $BasePixel $Bg 24)
          $SamplePass = $BaselineIsDistinct -and (Near-Color $OutPixel $BasePixel 12)
          $Expected = "SOURCE_BASELINE"
        } else {
          $SamplePass = Near-Color $OutPixel $Bg 12
          $Expected = "BACKGROUND"
        }
        $FramePass = $FramePass -and $SamplePass
        $Samples += [ordered]@{ x=[int]$Sample.x; y=[int]$Sample.y; baseline=@($BasePixel.R,$BasePixel.G,$BasePixel.B); output=@($OutPixel.R,$OutPixel.G,$OutPixel.B); expected=$Expected; pass=$SamplePass }
      }
      $BgSample = $ProofPlan.visualExpectations.backgroundSample
      $BgPixel = $Review.GetPixel([int]$BgSample.x, [int]$BgSample.y)
      $BgPass = Near-Color $BgPixel $Bg 12
      $FramePass = $FramePass -and $BgPass
      $VisualEvidence += [ordered]@{ frameIndex=$Index; baselinePath=$BaselinePaths[$Index]; reviewPath=$ReviewPaths[$Index]; dimensionsPass=$DimensionsPass; samples=$Samples; background=@{x=[int]$BgSample.x;y=[int]$BgSample.y;rgb=@($BgPixel.R,$BgPixel.G,$BgPixel.B);pass=$BgPass}; pass=$FramePass }
      $AllFramesPass = $AllFramesPass -and $FramePass
    } finally { $Baseline.Dispose(); $Review.Dispose() }
  }
  $VisualCheckpointPassed = $AllFramesPass
  if ($HostResult.ok -eq $true -and $HostResult.cleanupComplete -eq $true -and $VisualCheckpointPassed) {
    $Classification = "PASS"
    $Message = "Segmentation sequence materialization transferred to materially different real footage with exact warm-project cleanup."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "Real-footage transfer checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_SEGMENTATION_SEQUENCE_TRANSFER_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    sourceHostId = $SourceHostId
    cleanupComplete = if ($HostResult) { [bool]$HostResult.cleanupComplete } else { $false }
    visualCheckpointPassed = $VisualCheckpointPassed
    visualEvidence = $VisualEvidence
    message = $Message
    hostResult = $HostResult
    artifacts = [ordered]@{ plan=$PlanPath; hostResult=$HostResultPath; baselineFrames=$BaselinePaths; reviewFrames=$ReviewPaths; generatedScript=$RunScriptPath }
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 64) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
