param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-segmentation-sequence-materialization" }
$RunId = if ($env:EDITFLOW_PROOF_RUN_ID) { $env:EDITFLOW_PROOF_RUN_ID } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
$env:EDITFLOW_PROOF_RUN_ID = $RunId
$env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-segmentation-sequence-materialization-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v25.jsx"
$PlanScript = Join-Path $RepoRoot "scripts\m4-segmentation-sequence-materialization-proof-plan.mjs"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-sequence-materialization-proof.jsx"
$ReviewPaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("dynamic-review-{0}.png" -f $_) })
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Dynamic sequence materialization proof did not complete."
$HostResult = $null
$VisualEvidence = @()
$VisualCheckpointPassed = $false
try {
  foreach ($Required in @($AfterFxPath, $TemplatePath, $HostLoaderPath, $PlanScript)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required proof file missing: $Required" }
  }
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
      if ($Candidate -and $Candidate.proofId -eq "M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_REAL_AE") {
        $HostResult = $Candidate
      }
    } catch { $HostResult = $null }
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Dynamic materialization host result was not valid JSON." }

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
      $DimensionsPass = $Bitmap.Width -eq [int]$ProofPlan.fixtures.width -and $Bitmap.Height -eq [int]$ProofPlan.fixtures.height
      $Samples = @()
      $FramePass = $DimensionsPass
      for ($SampleIndex = 0; $SampleIndex -lt 3; $SampleIndex++) {
        $Sample = $ProofPlan.visualExpectations.subjectSamples[$SampleIndex]
        $Pixel = $Bitmap.GetPixel([int]$Sample.x, [int]$Sample.y)
        $IsRed = $Pixel.R -ge 200 -and $Pixel.R -gt $Pixel.G -and $Pixel.G -le 130 -and $Pixel.B -le 100
        $IsBlue = $Pixel.B -ge 60 -and $Pixel.B -gt $Pixel.G -and $Pixel.G -gt $Pixel.R
        $SamplePass = if ($SampleIndex -eq $Index) { $IsRed } else { $IsBlue }
        $FramePass = $FramePass -and $SamplePass
        $Samples += [ordered]@{ x=[int]$Sample.x; y=[int]$Sample.y; r=$Pixel.R; g=$Pixel.G; b=$Pixel.B; expected=if($SampleIndex -eq $Index){'SUBJECT'}else{'BACKGROUND'}; pass=$SamplePass }
      }
      $Bg = $ProofPlan.visualExpectations.backgroundSample
      $BgPixel = $Bitmap.GetPixel([int]$Bg.x, [int]$Bg.y)
      $BgPass = $BgPixel.B -ge 60 -and $BgPixel.B -gt $BgPixel.G -and $BgPixel.G -gt $BgPixel.R
      $FramePass = $FramePass -and $BgPass
      $VisualEvidence += [ordered]@{
        frameIndex=$Index; path=$ReviewPaths[$Index]; dimensionsPass=$DimensionsPass;
        samples=$Samples; background=[ordered]@{x=[int]$Bg.x;y=[int]$Bg.y;r=$BgPixel.R;g=$BgPixel.G;b=$BgPixel.B;pass=$BgPass}; pass=$FramePass
      }
      $AllFramesPass = $AllFramesPass -and $FramePass
    } finally { $Bitmap.Dispose() }
  }
  $VisualCheckpointPassed = $AllFramesPass
  if ($HostResult.ok -eq $true -and $HostResult.cleanupComplete -eq $true -and $VisualCheckpointPassed) {
    $Classification = "PASS"
    $Message = "Dynamic segmentation sequence import, timing, matte binding, frame-to-frame visual motion, and warm-project cleanup passed."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "Dynamic temporal materialization checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    cleanupComplete = if ($HostResult) { [bool]$HostResult.cleanupComplete } else { $false }
    visualCheckpointPassed = $VisualCheckpointPassed
    visualEvidence = $VisualEvidence
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