param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$SourceHostId = 13,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-segmentation-sequence-p5" }
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$PlanScript = Join-Path $RepoRoot "scripts\m4-segmentation-sequence-transfer-proof-plan.mjs"
$ProofScript = Join-Path $RepoRoot "scripts\m4-segmentation-sequence-p5-proof.mjs"
$Stage1Template = Join-Path $RepoRoot "scripts\windows\m4-segmentation-sequence-p5-stage1-template.jsx"
$ReopenTemplate = Join-Path $RepoRoot "scripts\windows\m4-segmentation-sequence-p5-reopen-template.jsx"
$CleanupTemplate = Join-Path $RepoRoot "scripts\windows\m4-segmentation-sequence-p5-cleanup-template.jsx"
$BootstrapScript = Join-Path $RepoRoot "scripts\windows\open-editflow-bridge.jsx"
$HostLoader = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v25.jsx"
$PlanPath = Join-Path $ArtifactDir "plan.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$BaselinePaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("baseline-{0}.png" -f $_) })
$PreSavePaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("pre-save-{0}.png" -f $_) })
$ReopenPaths = @(0..2 | ForEach-Object { Join-Path $ArtifactDir ("post-reopen-{0}.png" -f $_) })
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$env:EDITFLOW_PROOF_ARTIFACT_DIR = $ArtifactDir
$env:EDITFLOW_M4_TRANSFER_SOURCE_HOST_ID = $SourceHostId.ToString()
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

function Near-Color([System.Drawing.Color]$A, [System.Drawing.Color]$B, [int]$Tolerance = 12) {
  return ([Math]::Abs([int]$A.R - [int]$B.R) -le $Tolerance) -and
    ([Math]::Abs([int]$A.G - [int]$B.G) -le $Tolerance) -and
    ([Math]::Abs([int]$A.B - [int]$B.B) -le $Tolerance)
}

function Resolve-CurrentAfterFx([string]$ExpectedPath) {
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -ne 1) { throw "M4 segmentation P5 requires exactly one already-running After Effects process; found $($Running.Count)." }
  $Process = $Running[0]
  if (-not $Process.Responding) { throw "The current After Effects process is not responding." }
  $RunningPath = $Process.Path
  if (-not $RunningPath) { throw "Could not resolve the current After Effects executable path." }
  $ResolvedRunning = (Resolve-Path $RunningPath).Path
  $ResolvedExpected = (Resolve-Path $ExpectedPath).Path
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals($ResolvedRunning, $ResolvedExpected)) {
    throw "The requested AfterFX path is not the already-running After Effects executable."
  }
  return $Process
}

$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "M4 segmentation P5 save/reopen/reconnect proof did not complete."
$ProofResult = $null
$VisualEvidence = @()
$VisualCheckpointPassed = $false
$NodeExit = $null

try {
  if ($TimeoutSeconds -lt 20) { throw "TimeoutSeconds must be at least 20." }
  if ($SourceHostId -le 0) { throw "SourceHostId must be positive." }
  foreach ($Required in @($AfterFxPath, $ConfigPath, $PlanScript, $ProofScript, $Stage1Template, $ReopenTemplate, $CleanupTemplate, $BootstrapScript, $HostLoader)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required P5 proof file missing: $Required" }
  }
  $Ae = Resolve-CurrentAfterFx $AfterFxPath
  Write-Host ("Reusing current After Effects PID " + $Ae.Id + ": " + $Ae.MainWindowTitle)
  Remove-Item $PlanPath, $ResultPath -Force -ErrorAction SilentlyContinue
  foreach ($Frame in @($BaselinePaths + $PreSavePaths + $ReopenPaths)) { Remove-Item $Frame -Force -ErrorAction SilentlyContinue }

  Push-Location $RepoRoot
  try {
    npm run build:test-runtime
    if ($LASTEXITCODE -ne 0) { throw "TypeScript proof runtime build failed." }
    node $PlanScript
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PlanPath -PathType Leaf)) { throw "Segmentation P5 proof-plan generation failed." }

    node $ProofScript `
      --config $ConfigPath `
      --result $ResultPath `
      --afterfx-path $AfterFxPath `
      --bootstrap-script $BootstrapScript `
      --stage1-template $Stage1Template `
      --reopen-template $ReopenTemplate `
      --cleanup-template $CleanupTemplate `
      --plan $PlanPath `
      --host-loader $HostLoader `
      --timeout-ms ($TimeoutSeconds * 1000)
    $NodeExit = $LASTEXITCODE
  } finally { Pop-Location }

  if (-not (Test-Path $ResultPath -PathType Leaf)) { throw "P5 orchestrator exited without result.json (exit $NodeExit)." }
  $ProofResult = Get-Content $ResultPath -Raw | ConvertFrom-Json
  if ($ProofResult.proofId -ne "M4_SEGMENTATION_SEQUENCE_P5_SAVE_REOPEN_RECONNECT") { throw "Unexpected P5 result proofId." }

  $FrameDeadline = (Get-Date).AddSeconds(8)
  do {
    $Missing = @(@($BaselinePaths + $PreSavePaths + $ReopenPaths) | Where-Object { -not (Test-Path $_ -PathType Leaf) })
    if ($Missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $FrameDeadline)

  if ($Missing.Count -eq 0) {
    Add-Type -AssemblyName System.Drawing
    $ProofPlan = Get-Content $PlanPath -Raw | ConvertFrom-Json
    $Bg = [System.Drawing.Color]::FromArgb(255, [int]$ProofPlan.fixtures.backgroundRgb[0], [int]$ProofPlan.fixtures.backgroundRgb[1], [int]$ProofPlan.fixtures.backgroundRgb[2])
    $AllFramesPass = $true
    for ($Index = 0; $Index -lt 3; $Index++) {
      $Baseline = [System.Drawing.Bitmap]::FromFile($BaselinePaths[$Index])
      $Before = [System.Drawing.Bitmap]::FromFile($PreSavePaths[$Index])
      $After = [System.Drawing.Bitmap]::FromFile($ReopenPaths[$Index])
      try {
        $DimensionsPass = $Baseline.Width -eq [int]$ProofPlan.fixtures.compWidth -and $Baseline.Height -eq [int]$ProofPlan.fixtures.compHeight -and
          $Before.Width -eq $Baseline.Width -and $Before.Height -eq $Baseline.Height -and $After.Width -eq $Baseline.Width -and $After.Height -eq $Baseline.Height
        $Samples = @()
        $FramePass = $DimensionsPass
        for ($SampleIndex = 0; $SampleIndex -lt 3; $SampleIndex++) {
          $Sample = $ProofPlan.visualExpectations.subjectSamples[$SampleIndex]
          $BasePixel = $Baseline.GetPixel([int]$Sample.x, [int]$Sample.y)
          $BeforePixel = $Before.GetPixel([int]$Sample.x, [int]$Sample.y)
          $AfterPixel = $After.GetPixel([int]$Sample.x, [int]$Sample.y)
          if ($SampleIndex -eq $Index) {
            $BaselineIsDistinct = -not (Near-Color $BasePixel $Bg 24)
            $BeforePass = $BaselineIsDistinct -and (Near-Color $BeforePixel $BasePixel 12)
            $AfterPass = $BaselineIsDistinct -and (Near-Color $AfterPixel $BasePixel 12)
            $Expected = "SOURCE_BASELINE"
          } else {
            $BeforePass = Near-Color $BeforePixel $Bg 12
            $AfterPass = Near-Color $AfterPixel $Bg 12
            $Expected = "BACKGROUND"
          }
          $StablePass = Near-Color $BeforePixel $AfterPixel 12
          $SamplePass = $BeforePass -and $AfterPass -and $StablePass
          $FramePass = $FramePass -and $SamplePass
          $Samples += [ordered]@{ x=[int]$Sample.x; y=[int]$Sample.y; baseline=@($BasePixel.R,$BasePixel.G,$BasePixel.B); preSave=@($BeforePixel.R,$BeforePixel.G,$BeforePixel.B); postReopen=@($AfterPixel.R,$AfterPixel.G,$AfterPixel.B); expected=$Expected; stableAcrossBoundary=$StablePass; pass=$SamplePass }
        }
        $BgSample = $ProofPlan.visualExpectations.backgroundSample
        $BeforeBg = $Before.GetPixel([int]$BgSample.x, [int]$BgSample.y)
        $AfterBg = $After.GetPixel([int]$BgSample.x, [int]$BgSample.y)
        $BgPass = (Near-Color $BeforeBg $Bg 12) -and (Near-Color $AfterBg $Bg 12) -and (Near-Color $BeforeBg $AfterBg 12)
        $FramePass = $FramePass -and $BgPass
        $VisualEvidence += [ordered]@{ frameIndex=$Index; dimensionsPass=$DimensionsPass; samples=$Samples; background=@{x=[int]$BgSample.x;y=[int]$BgSample.y;preSave=@($BeforeBg.R,$BeforeBg.G,$BeforeBg.B);postReopen=@($AfterBg.R,$AfterBg.G,$AfterBg.B);pass=$BgPass}; pass=$FramePass }
        $AllFramesPass = $AllFramesPass -and $FramePass
      } finally { $Baseline.Dispose(); $Before.Dispose(); $After.Dispose() }
    }
    $VisualCheckpointPassed = $AllFramesPass
  }

  $OrchestratorPassed = $ProofResult.ok -eq $true -and $ProofResult.cleanupComplete -eq $true -and $NodeExit -eq 0
  if ($OrchestratorPassed -and $VisualCheckpointPassed) {
    $Classification = "PASS"
    $Message = "Segmentation sequence materialization survived save/reopen plus a distinct authenticated CEP reconnect, retained exact temporal matte readback, accepted a fresh post-reconnect matte mutation, preserved visual output, and restored the saved user-project baseline."
  } elseif ($NodeExit -ne 0 -or $ProofResult.status -eq "FAILED") {
    $Classification = "PRODUCT_FAILURE"
    $Message = if ($ProofResult.failure) { [string]$ProofResult.failure } else { "P5 lifecycle checks failed." }
  } else {
    $Classification = "PRODUCT_FAILURE"
    $Message = "P5 lifecycle visual checkpoint failed."
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  if ($ProofResult) {
    $ProofResult | Add-Member -NotePropertyName classification -NotePropertyValue $Classification -Force
    $ProofResult | Add-Member -NotePropertyName visualCheckpointPassed -NotePropertyValue $VisualCheckpointPassed -Force
    $ProofResult | Add-Member -NotePropertyName visualEvidence -NotePropertyValue $VisualEvidence -Force
    $ProofResult | Add-Member -NotePropertyName message -NotePropertyValue $Message -Force
    $ProofResult.ok = ($Classification -eq "PASS")
    $ProofResult.status = if ($Classification -eq "PASS") { "ACCEPTED" } else { "FAILED" }
    [System.IO.File]::WriteAllText($ResultPath, (($ProofResult | ConvertTo-Json -Depth 80) + [Environment]::NewLine), $Utf8NoBom)
  }
}

if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
