param(
  [Parameter(Mandatory=$true)][string]$Finish,
  [Parameter(Mandatory=$true)][string[]]$StartVideo,
  [string[]]$StartAudio = @(),
  [Parameter(Mandatory=$true)][string]$EditTypeId,
  [string]$SessionId = "",
  [string]$StateDir = "",
  [int]$MaxAttempts = 2,
  [double]$MinimumSimilarity = 0.95,
  [double]$StretchSimilarity = 0.99,
  [double]$ExactSceneConfidence = 0.95,
  [double]$MinimumAudioConfidence = 0.90,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$LiveProof = Join-Path $PSScriptRoot "run-practice-live-proof.ps1"
if (-not (Test-Path $LiveProof -PathType Leaf)) {
  throw "Practice live proof runner is missing: $LiveProof"
}

$Arguments = @{
  Finish = $Finish
  StartVideo = $StartVideo
  StartAudio = $StartAudio
  EditTypeId = $EditTypeId
  MaxAttempts = $MaxAttempts
  MinimumSimilarity = $MinimumSimilarity
  StretchSimilarity = $StretchSimilarity
  ExactSceneConfidence = $ExactSceneConfidence
  MinimumAudioConfidence = $MinimumAudioConfidence
  TimeoutSeconds = $TimeoutSeconds
  HeldOutCertification = $true
  ExpectedIsolationBackend = "ROTO_BRUSH_TRACK_MATTE"
  ExpectedIsolationFallbackAfter = "SAM31_TEMPORAL_MATTE"
}
if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
  $Arguments.SessionId = $SessionId
}
if (-not [string]::IsNullOrWhiteSpace($StateDir)) {
  $Arguments.StateDir = $StateDir
}

Write-Host "Starting held-out SAM -> Roto Brush Practice certification."
& $LiveProof @Arguments
exit $LASTEXITCODE
