param(
  [string]$SourceA = "C:\Users\Shadow\Downloads\Main Clips\Peter Parker - The Amazing Spider-Man [2012] - [REMUX 4K HEVC-H265] - chaszq-00.51.24.562-00.51.42.047.mp4",
  [string]$SourceB = "C:\Users\Shadow\Downloads\Typical Pro Edits\Clipto AI Video Downloader Best Christmas Movie OAT_ - Home Alone  2 Edit _ Mariah Carey - All I Want For Christmas Is You.mp4",
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 20
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ExportRunner = Join-Path $RepoRoot "scripts\windows\run-m5-roto-brush-export-live-proof.ps1"
$ExportArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m5-roto-brush-export-live-proof"
$ExportResultPath = Join-Path $ExportArtifactDir "result.json"
$ArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m5-roto-brush-transfer-live-proof"
$ResultPath = Join-Path $ArtifactDir "result.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($Required in @($AfterFxPath,$SourceA,$SourceB,$ExportRunner)) {
  if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "Required M5 transfer proof file missing: $Required" }
}
$BaselineAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
if ($BaselineAePids.Count -ne 1) { throw "M5 transfer proof requires exactly one already-running After Effects process; found $($BaselineAePids.Count)." }
$SourceAHash = (Get-FileHash -LiteralPath $SourceA -Algorithm SHA256).Hash.ToLowerInvariant()
$SourceBHash = (Get-FileHash -LiteralPath $SourceB -Algorithm SHA256).Hash.ToLowerInvariant()
if ($SourceAHash -eq $SourceBHash) { throw "M5 transfer proof requires materially distinct source bytes." }

Remove-Item $ArtifactDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$CycleResults = @()
$CycleSpecs = @(
  [ordered]@{ label="source-b"; path=$SourceB; digest=$SourceBHash; layerName="EF2_M5_ROTO_XFER_B" },
  [ordered]@{ label="source-a"; path=$SourceA; digest=$SourceAHash; layerName="EF2_M5_ROTO_XFER_A" }
)
$PrimaryFailure = $null
try {
  foreach ($Cycle in $CycleSpecs) {
    Remove-Item $ExportArtifactDir -Recurse -Force -ErrorAction SilentlyContinue
    $CycleLog = Join-Path $ArtifactDir ($Cycle.label + "-runner.log")
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ExportRunner -AfterFxPath $AfterFxPath -SourcePath $Cycle.path -LayerName $Cycle.layerName -TimeoutSeconds $TimeoutSeconds > $CycleLog 2>&1
    $CycleExit = $LASTEXITCODE
    if ($CycleExit -ne 0 -or -not (Test-Path $ExportResultPath -PathType Leaf)) {
      throw ("M5 transfer " + $Cycle.label + " TRACK_MATTE export failed; see " + $CycleLog)
    }
    $Inner = Get-Content $ExportResultPath -Raw | ConvertFrom-Json
    if ($Inner.proofId -ne "M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_RETAINED_REAL_AE_V1" -or $Inner.ok -ne $true -or $Inner.classification -ne "PASS") {
      throw ("M5 transfer " + $Cycle.label + " did not retain an accepted export result.")
    }
    if ($Inner.sameAeProcess -ne $true -or $Inner.restoreAttempted -ne $true -or $Inner.restoreStabilityVerified -ne $true) {
      throw ("M5 transfer " + $Cycle.label + " did not prove same-process exact restore.")
    }
    if ($Inner.live.speed.subSecondAll -ne $true -or $Inner.live.speed.withinThreeSecondCeiling -ne $true) {
      throw ("M5 transfer " + $Cycle.label + " violated the warm-action latency gate.")
    }
    $CycleArtifact = Join-Path $ArtifactDir $Cycle.label
    New-Item -ItemType Directory -Force -Path $CycleArtifact | Out-Null
    Copy-Item -Path (Join-Path $ExportArtifactDir "*") -Destination $CycleArtifact -Recurse -Force
    $CycleResults += [pscustomobject][ordered]@{
      label = $Cycle.label
      sourcePath = $Cycle.path
      sourceSha256 = $Cycle.digest
      artifactDir = $CycleArtifact
      compWidth = [int]$Inner.fixture.width
      compHeight = [int]$Inner.fixture.height
      frameRate = [double]$Inner.fixture.frameRate
      duration = [double]$Inner.fixture.duration
      outputStableId = [string]$Inner.live.export.exportStableId
      structuralOutputVerified = [bool]$Inner.live.export.structuralOutputVerified
      nativeRotoOutputVerified = [bool]$Inner.live.export.nativeRotoOutputVerified
      maxAeActionGapMs = [double]$Inner.live.speed.maxAeActionGapMs
      exportMutationRoundtripMs = [double]$Inner.live.speed.exportMutationRoundtripMs
      sameAeProcess = [bool]$Inner.sameAeProcess
      restoreStabilityVerified = [bool]$Inner.restoreStabilityVerified
    }
  }
} catch {
  $PrimaryFailure = $_.Exception.Message
}
$AfterAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
$SameAeProcess = (($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
$MateriallyDifferentMetadata = $false
if ($CycleResults.Count -eq 2) {
  $A=$CycleResults[0]; $B=$CycleResults[1]
  $MateriallyDifferentMetadata = ($A.compWidth -ne $B.compWidth) -or ($A.compHeight -ne $B.compHeight) -or ([math]::Abs($A.frameRate-$B.frameRate) -gt 0.001) -or ([math]::Abs($A.duration-$B.duration) -gt 0.001)
}
$AllSubSecond = $CycleResults.Count -eq 2 -and (@($CycleResults | Where-Object { $_.maxAeActionGapMs -ge 1000 -or $_.exportMutationRoundtripMs -ge 1000 }).Count -eq 0)
$AllOutputsVerified = $CycleResults.Count -eq 2 -and (@($CycleResults | Where-Object { -not $_.structuralOutputVerified -or -not $_.nativeRotoOutputVerified -or $_.outputStableId -ne "M5_ROTO_TRACK_MATTE_001" }).Count -eq 0)
$Ok = $null -eq $PrimaryFailure -and $CycleResults.Count -eq 2 -and $SameAeProcess -and ($SourceAHash -ne $SourceBHash) -and $MateriallyDifferentMetadata -and $AllSubSecond -and $AllOutputsVerified
$MaxGap = if ($CycleResults.Count -gt 0) { ($CycleResults | Measure-Object -Property maxAeActionGapMs -Maximum).Maximum } else { $null }
$Result = [ordered]@{
  proofId = "M5_ROTO_BRUSH_MATERIAL_TRANSFER_RETAINED_REAL_AE_V1"
  classification = if ($Ok) { "PASS" } else { "PRODUCT_FAILURE" }
  ok = $Ok
  message = if ($Ok) { "M5 Roto Brush transfer passed on materially different footage with stable TRACK_MATTE output, exact native Roto preservation, sub-second warm actions, exact restore, and one AE process." } elseif ($PrimaryFailure) { $PrimaryFailure } elseif (-not $MateriallyDifferentMetadata) { "Source bytes differ but imported geometry/timing did not establish material fixture difference." } else { "M5 Roto Brush transfer gates were not all satisfied." }
  baselineAePids = $BaselineAePids
  afterAePids = $AfterAePids
  sameAeProcess = $SameAeProcess
  materialDifference = [ordered]@{ differentSourceDigest=($SourceAHash -ne $SourceBHash); differentImportedGeometryOrTiming=$MateriallyDifferentMetadata }
  speed = [ordered]@{ maxAeActionGapMs=$MaxGap; subSecondAll=$AllSubSecond; withinThreeSecondCeiling=($MaxGap -ne $null -and $MaxGap -le 3000) }
  cycles = $CycleResults
  failure = $PrimaryFailure
}
[System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $Utf8NoBom)
if (-not $Ok) { Write-Error $Result.message; exit 1 }
Write-Host $Result.message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Max measured AE action gap across transfer: " + $MaxGap + " ms")
