param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-segmentation-matte-materialization" }
$RunId = if ($env:EDITFLOW_PROOF_RUN_ID) { $env:EDITFLOW_PROOF_RUN_ID } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
$env:EDITFLOW_PROOF_RUN_ID = $RunId
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-segmentation-matte-materialization-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current.jsx"
$PlanScript = Join-Path $RepoRoot "scripts\m4-segmentation-matte-materialization-proof-plan.mjs"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-materialization-proof.jsx"
$RenderPath = Join-Path $ArtifactDir ("materialized-matte-proof-" + $RunId + ".mp4")
$ReviewFramePath = Join-Path $ArtifactDir ("materialized-matte-review-" + $RunId + ".png")
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Materialization proof did not complete."
$MutationStarted = $false
$CleanupComplete = $false
$ReviewFrameEmitted = $false
$VisualCheckpointPassed = $false
$VisualEvidence = $null
$HostResult = $null
try {
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe not found: $AfterFxPath" }
  foreach ($Required in @($TemplatePath, $HostLoaderPath, $PlanScript)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required proof file missing: $Required" }
  }
  Remove-Item $HostResultPath, $ResultPath, $RunScriptPath, $RenderPath, $ReviewFramePath -Force -ErrorAction SilentlyContinue

  Push-Location $RepoRoot
  try {
    $Classification = "PRODUCT_FAILURE"
    npm.cmd run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }
    $env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) {
      throw "Materialization proof-plan generation failed."
    }
  } finally {
    Pop-Location
  }

  $Template = [System.IO.File]::ReadAllText($TemplatePath)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_PLAN_PATH__", (& $ForJs $PlanPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_LOADER__", (& $ForJs $HostLoaderPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  $Generated = $Generated.Replace("__EDITFLOW_RENDER_PATH__", (& $ForJs $RenderPath))
  $Generated = $Generated.Replace("__EDITFLOW_REVIEW_FRAME_PATH__", (& $ForJs $ReviewFramePath))
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "INFRASTRUCTURE_FAILURE"
  $Arguments = @("-r", $RunScriptPath)
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) {
    throw "Timed out waiting for the warm AE materialization proof result."
  }

  $HostReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $HostReadDeadline -and $null -eq $HostResult) {
    try {
      $Candidate = Get-Content $HostResultPath -Raw | ConvertFrom-Json
      if ($Candidate -and $Candidate.proofId -eq "M4_SEGMENTATION_MATTE_MATERIALIZATION_REAL_AE" -and $null -ne $Candidate.checks) {
        $HostResult = $Candidate
      }
    } catch {}
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Timed out waiting for a complete real-AE host-result JSON document." }
  $MutationStarted = [bool]$HostResult.mutationStarted
  $CleanupComplete = [bool]$HostResult.cleanupComplete
  $ReviewDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReviewDeadline -and -not (Test-Path $ReviewFramePath -PathType Leaf)) {
    Start-Sleep -Milliseconds 50
  }
  if (Test-Path $ReviewFramePath -PathType Leaf) {
    $ReviewFrameEmitted = (Get-Item $ReviewFramePath).Length -gt 0
  }
  if ($ReviewFrameEmitted) {
    Add-Type -AssemblyName System.Drawing
    $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json
    $Bitmap = [System.Drawing.Bitmap]::FromFile($ReviewFramePath)
    try {
      $SubjectSample = $ProofPlan.visualExpectations.subjectSample
      $SubjectPixel = $Bitmap.GetPixel([int]$SubjectSample.x, [int]$SubjectSample.y)
      $SubjectPass = $SubjectPixel.R -ge 220 -and $SubjectPixel.G -ge 40 -and $SubjectPixel.G -le 210 -and $SubjectPixel.B -le 100 -and $SubjectPixel.R -gt $SubjectPixel.G
      $BackgroundPass = $true
      $BackgroundPixels = @()
      foreach ($Sample in @($ProofPlan.visualExpectations.backgroundSamples)) {
        $Pixel = $Bitmap.GetPixel([int]$Sample.x, [int]$Sample.y)
        $SamplePass = $Pixel.B -gt $Pixel.G -and $Pixel.G -gt $Pixel.R -and $Pixel.B -le 140
        $BackgroundPass = $BackgroundPass -and $SamplePass
        $BackgroundPixels += [ordered]@{ x = [int]$Sample.x; y = [int]$Sample.y; r = $Pixel.R; g = $Pixel.G; b = $Pixel.B; pass = $SamplePass }
      }
      $DimensionsPass = $Bitmap.Width -eq [int]$ProofPlan.fixtures.width -and $Bitmap.Height -eq [int]$ProofPlan.fixtures.height
      $VisualCheckpointPassed = $DimensionsPass -and $SubjectPass -and $BackgroundPass
      $VisualEvidence = [ordered]@{
        dimensions = [ordered]@{ width = $Bitmap.Width; height = $Bitmap.Height; pass = $DimensionsPass }
        subjectPixel = [ordered]@{ x = [int]$SubjectSample.x; y = [int]$SubjectSample.y; r = $SubjectPixel.R; g = $SubjectPixel.G; b = $SubjectPixel.B; pass = $SubjectPass }
        backgroundPixels = $BackgroundPixels
      }
    } finally {
      $Bitmap.Dispose()
    }
  }
  if ($HostResult.ok -eq $true -and $CleanupComplete -and $ReviewFrameEmitted -and $VisualCheckpointPassed) {
    $Classification = "PASS"
    $Message = "Exact planned segmentation matte operations passed real-AE host dispatch/readback, rollback/reapply, pixel-validated visual isolation, and warm-project baseline restoration."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "Real-AE materialization checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_SEGMENTATION_MATTE_MATERIALIZATION_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    mutationStarted = $MutationStarted
    cleanupComplete = $CleanupComplete
    reviewFrameEmitted = $ReviewFrameEmitted
    visualCheckpointPassed = $VisualCheckpointPassed
    visualEvidence = $VisualEvidence
    message = $Message
    hostResult = $HostResult
    artifacts = [ordered]@{
      plan = $PlanPath
      hostResult = $HostResultPath
      render = $RenderPath
      reviewFrame = $ReviewFramePath
      generatedScript = $RunScriptPath
    }
  }
  $Json = $Result | ConvertTo-Json -Depth 64
  [System.IO.File]::WriteAllText($ResultPath, $Json + [Environment]::NewLine, $Utf8NoBom)
}

if ($Classification -ne "PASS") {
  Write-Error $Message
  exit 1
}
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Retained visual artifact: " + $RenderPath)
Write-Host ("Retained review frame: " + $ReviewFramePath)
