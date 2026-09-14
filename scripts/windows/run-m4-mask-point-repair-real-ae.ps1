param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-mask-point-repair-real-ae" }
$RunId = if ($env:EDITFLOW_PROOF_RUN_ID) { $env:EDITFLOW_PROOF_RUN_ID } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
$env:EDITFLOW_PROOF_RUN_ID = $RunId
$TemplatePath = Join-Path $RepoRoot "scripts\windows\m4-mask-point-repair-real-ae-template.jsx"
$HostLoaderPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current.jsx"
$PlanScript = Join-Path $RepoRoot "scripts\m4-mask-point-repair-proof-plan.mjs"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-mask-point-repair-proof.jsx"
$WrongFramePath = Join-Path $ArtifactDir ("mask-point-wrong-" + $RunId + ".png")
$RepairedFramePath = Join-Path $ArtifactDir ("mask-point-repaired-" + $RunId + ".png")
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Mask-point repair proof did not complete."
$MutationStarted = $false
$CleanupComplete = $false
$WrongFrameEmitted = $false
$RepairedFrameEmitted = $false
$VisualCheckpointPassed = $false
$VisualEvidence = $null
$HostResult = $null
try {
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe not found: $AfterFxPath" }
  foreach ($Required in @($TemplatePath, $HostLoaderPath, $PlanScript)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required proof file missing: $Required" }
  }
  Remove-Item $HostResultPath, $ResultPath, $RunScriptPath, $WrongFramePath, $RepairedFramePath -Force -ErrorAction SilentlyContinue

  Push-Location $RepoRoot
  try {
    $Classification = "PRODUCT_FAILURE"
    npm.cmd run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "TypeScript runtime build failed." }
    $env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) {
      throw "Mask-point repair proof-plan generation failed."
    }
  } finally {
    Pop-Location
  }
  $Template = [System.IO.File]::ReadAllText($TemplatePath)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_PLAN_PATH__", (& $ForJs $PlanPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_LOADER__", (& $ForJs $HostLoaderPath))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  $Generated = $Generated.Replace("__EDITFLOW_WRONG_FRAME_PATH__", (& $ForJs $WrongFramePath))
  $Generated = $Generated.Replace("__EDITFLOW_REPAIRED_FRAME_PATH__", (& $ForJs $RepairedFramePath))
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "INFRASTRUCTURE_FAILURE"
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $RunScriptPath) -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) {
    throw "Timed out waiting for the warm AE mask-point repair proof result."
  }

  $HostReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $HostReadDeadline -and $null -eq $HostResult) {
    try {
      $Candidate = Get-Content $HostResultPath -Raw | ConvertFrom-Json
      if ($Candidate -and $Candidate.proofId -eq "M4_MASK_POINT_REPAIR_REAL_AE" -and $null -ne $Candidate.checks) {
        $HostResult = $Candidate
      }
    } catch {}
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Timed out waiting for a complete real-AE host-result JSON document." }
  $MutationStarted = [bool]$HostResult.mutationStarted
  $CleanupComplete = [bool]$HostResult.cleanupComplete

  $FrameDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $FrameDeadline -and (-not (Test-Path $WrongFramePath -PathType Leaf) -or -not (Test-Path $RepairedFramePath -PathType Leaf))) {
    Start-Sleep -Milliseconds 50
  }
  $WrongFrameEmitted = (Test-Path $WrongFramePath -PathType Leaf) -and (Get-Item $WrongFramePath).Length -gt 0
  $RepairedFrameEmitted = (Test-Path $RepairedFramePath -PathType Leaf) -and (Get-Item $RepairedFramePath).Length -gt 0

  if ($WrongFrameEmitted -and $RepairedFrameEmitted) {
    Add-Type -AssemblyName System.Drawing
    $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json
    $WrongBitmap = [System.Drawing.Bitmap]::FromFile($WrongFramePath)
    $RepairedBitmap = [System.Drawing.Bitmap]::FromFile($RepairedFramePath)
    try {
      $RepairSample = $ProofPlan.visualExpectations.repairedSample
      $StableSample = $ProofPlan.visualExpectations.stableInsideSample
      $OutsideSample = $ProofPlan.visualExpectations.outsideSample
      $WrongRepairPixel = $WrongBitmap.GetPixel([int]$RepairSample.x, [int]$RepairSample.y)
      $RepairedRepairPixel = $RepairedBitmap.GetPixel([int]$RepairSample.x, [int]$RepairSample.y)
      $WrongStablePixel = $WrongBitmap.GetPixel([int]$StableSample.x, [int]$StableSample.y)
      $RepairedStablePixel = $RepairedBitmap.GetPixel([int]$StableSample.x, [int]$StableSample.y)
      $WrongOutsidePixel = $WrongBitmap.GetPixel([int]$OutsideSample.x, [int]$OutsideSample.y)
      $RepairedOutsidePixel = $RepairedBitmap.GetPixel([int]$OutsideSample.x, [int]$OutsideSample.y)
      $Fg = $ProofPlan.visualExpectations.foreground
      $Bg = $ProofPlan.visualExpectations.background
      $IsForeground = {
        param($Pixel)
        $Pixel.R -ge [int]$Fg.rMin -and $Pixel.G -le [int]$Fg.gMax -and $Pixel.B -le [int]$Fg.bMax
      }
      $IsBackground = {
        param($Pixel)
        $Pixel.R -le [int]$Bg.rMax -and $Pixel.G -ge [int]$Bg.gMin -and $Pixel.G -le [int]$Bg.gMax -and $Pixel.B -ge [int]$Bg.bMin
      }
      $DimensionsPass = $WrongBitmap.Width -eq [int]$ProofPlan.fixture.width -and $WrongBitmap.Height -eq [int]$ProofPlan.fixture.height `
        -and $RepairedBitmap.Width -eq [int]$ProofPlan.fixture.width -and $RepairedBitmap.Height -eq [int]$ProofPlan.fixture.height
      $WrongRepairPass = & $IsBackground $WrongRepairPixel
      $RepairedRepairPass = & $IsForeground $RepairedRepairPixel
      $StablePass = (& $IsForeground $WrongStablePixel) -and (& $IsForeground $RepairedStablePixel)
      $OutsidePass = (& $IsBackground $WrongOutsidePixel) -and (& $IsBackground $RepairedOutsidePixel)
      $VisualCheckpointPassed = $DimensionsPass -and $WrongRepairPass -and $RepairedRepairPass -and $StablePass -and $OutsidePass
      $VisualEvidence = [ordered]@{
        dimensions = [ordered]@{ width = $WrongBitmap.Width; height = $WrongBitmap.Height; pass = $DimensionsPass }
        repairedSample = [ordered]@{
          x = [int]$RepairSample.x; y = [int]$RepairSample.y
          wrong = [ordered]@{ r = $WrongRepairPixel.R; g = $WrongRepairPixel.G; b = $WrongRepairPixel.B; backgroundPass = $WrongRepairPass }
          repaired = [ordered]@{ r = $RepairedRepairPixel.R; g = $RepairedRepairPixel.G; b = $RepairedRepairPixel.B; foregroundPass = $RepairedRepairPass }
        }
        stableInside = [ordered]@{
          x = [int]$StableSample.x; y = [int]$StableSample.y
          wrong = [ordered]@{ r = $WrongStablePixel.R; g = $WrongStablePixel.G; b = $WrongStablePixel.B }
          repaired = [ordered]@{ r = $RepairedStablePixel.R; g = $RepairedStablePixel.G; b = $RepairedStablePixel.B; pass = $StablePass }
        }
        outside = [ordered]@{
          x = [int]$OutsideSample.x; y = [int]$OutsideSample.y
          wrong = [ordered]@{ r = $WrongOutsidePixel.R; g = $WrongOutsidePixel.G; b = $WrongOutsidePixel.B }
          repaired = [ordered]@{ r = $RepairedOutsidePixel.R; g = $RepairedOutsidePixel.G; b = $RepairedOutsidePixel.B; pass = $OutsidePass }
        }
      }
    } finally {
      $WrongBitmap.Dispose()
      $RepairedBitmap.Dispose()
    }
  }

  if ($HostResult.ok -eq $true -and $CleanupComplete -and $WrongFrameEmitted -and $RepairedFrameEmitted -and $VisualCheckpointPassed) {
    $Classification = "PASS"
    $Message = "Exact mask-point repair passed warm real-AE path write/readback, induced-failure Undo recovery, reapply, pixel-validated viewer-visible correction, and baseline cleanup."
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($HostResult.failure) { [string]$HostResult.failure } else { "Real-AE mask-point repair checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_MASK_POINT_REPAIR_REAL_AE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    mutationStarted = $MutationStarted
    cleanupComplete = $CleanupComplete
    wrongFrameEmitted = $WrongFrameEmitted
    repairedFrameEmitted = $RepairedFrameEmitted
    visualCheckpointPassed = $VisualCheckpointPassed
    visualEvidence = $VisualEvidence
    message = $Message
    hostResult = $HostResult
    artifacts = [ordered]@{
      plan = $PlanPath
      hostResult = $HostResultPath
      wrongFrame = $WrongFramePath
      repairedFrame = $RepairedFramePath
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
Write-Host ("Wrong-mask frame: " + $WrongFramePath)
Write-Host ("Repaired-mask frame: " + $RepairedFramePath)
