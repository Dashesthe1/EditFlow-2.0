param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 45
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ArtifactDir = if ($env:EDITFLOW_PROOF_ARTIFACT_DIR) { $env:EDITFLOW_PROOF_ARTIFACT_DIR } else { Join-Path $RepoRoot "proofs\artifacts\m4-media-sequence-v25-live" }
$ProofSource = Join-Path $RepoRoot "scripts\windows\m4-media-sequence-v25-live-proof.jsx"
$HostResultPath = Join-Path $ArtifactDir "host-result.json"
$ResultPath = Join-Path $ArtifactDir "result.json"
$RunScriptPath = Join-Path $ArtifactDir "run-media-sequence-v25-proof.jsx"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$Classification = "INFRASTRUCTURE_FAILURE"
$Message = "Protocol 2.5 media-sequence proof did not complete."
$MutationStarted = $false
$CleanupComplete = $false
$HostResult = $null
try {
  if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe not found: $AfterFxPath" }
  if (-not (Test-Path $ProofSource -PathType Leaf)) { throw "Media-sequence proof source missing: $ProofSource" }
  Remove-Item $HostResultPath, $ResultPath, $RunScriptPath -Force -ErrorAction SilentlyContinue
  Add-Type -AssemblyName System.Drawing
  for ($Index = 1; $Index -le 3; $Index++) {
    $FramePath = Join-Path $ArtifactDir ("mask-sequence-{0:D4}.bmp" -f $Index)
    $Bitmap = New-Object System.Drawing.Bitmap(64, 48)
    try {
      for ($Y = 0; $Y -lt 48; $Y++) {
        for ($X = 0; $X -lt 64; $X++) {
          $Inside = (($X - (12 + $Index * 8)) * ($X - (12 + $Index * 8)) + ($Y - 24) * ($Y - 24)) -lt 140
          $Value = if ($Inside) { 255 } else { 0 }
          $Bitmap.SetPixel($X, $Y, [System.Drawing.Color]::FromArgb($Value, $Value, $Value))
        }
      }
      $Bitmap.Save($FramePath, [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $Bitmap.Dispose() }
  }
  $FirstFrame = Join-Path $ArtifactDir "mask-sequence-0001.bmp"
  $Template = [System.IO.File]::ReadAllText($ProofSource)
  $ForJs = { param([string]$Path) $Path.Replace('\', '/').Replace('"', '\"') }
  $Generated = $Template.Replace("__EDITFLOW_REPO_ROOT__", (& $ForJs $RepoRoot))
  $Generated = $Generated.Replace("__EDITFLOW_FIRST_FRAME__", (& $ForJs $FirstFrame))
  $Generated = $Generated.Replace("__EDITFLOW_HOST_RESULT__", (& $ForJs $HostResultPath))
  [System.IO.File]::WriteAllText($RunScriptPath, $Generated, $Utf8NoBom)

  $Classification = "PRODUCT_FAILURE"
  $Arguments = @('-r', $RunScriptPath)
  [void](Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments -PassThru)
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $HostResultPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $HostResultPath -PathType Leaf)) { throw "Timed out waiting for protocol 2.5 host result." }
  $ReadDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $ReadDeadline -and $null -eq $HostResult) {
    try { $HostResult = Get-Content $HostResultPath -Raw | ConvertFrom-Json } catch { $HostResult = $null }
    if ($null -eq $HostResult) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $HostResult) { throw "Protocol 2.5 host result was not valid JSON." }
  $MutationStarted = [bool]$HostResult.mutationStarted
  $CleanupComplete = [bool]$HostResult.cleanupComplete
  if ($HostResult.ok -eq $true -and $CleanupComplete) {
    $Classification = "PASS"
    $Message = "Protocol 2.5 native media-sequence import/readback, idempotency, stale-revision refusal, rollback, and cleanup passed in warm After Effects."
  } else {
    $Message = if ($HostResult.error) { [string]$HostResult.error } else { "Protocol 2.5 host checks failed." }
  }
} catch {
  $Message = $_.Exception.Message
} finally {
  $Result = [ordered]@{
    proofId = "M4_MEDIA_SEQUENCE_V25_LIVE"
    classification = $Classification
    ok = ($Classification -eq "PASS")
    mutationStarted = $MutationStarted
    cleanupComplete = $CleanupComplete
    message = $Message
    hostResult = $HostResult
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 64) + [Environment]::NewLine), $Utf8NoBom)
}
if ($Classification -ne "PASS") { Write-Error $Message; exit 1 }
Write-Host $Message
Write-Host ("Result: " + $ResultPath)
