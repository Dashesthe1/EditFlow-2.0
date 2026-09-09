param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$artifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $artifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$resultPath = Join-Path $artifactDir "result.json"
$screenshotPath = Join-Path $artifactDir "after-effects.png"
$treePath = Join-Path $artifactDir "after-effects-ui-tree.txt"
$statusPath = Join-Path $artifactDir "after-effects-ui-status.json"

function Write-Result([string]$classification, [string]$message, [hashtable]$extra = @{}) {
  $result = [ordered]@{
    classification = $classification
    message = $message
    mutationStarted = $false
    cleanupComplete = $true
    aeProcessPreserved = $true
  }
  foreach ($k in $extra.Keys) { $result[$k] = $extra[$k] }
  $result | ConvertTo-Json -Depth 8 | Set-Content -Path $resultPath -Encoding UTF8
}

try {
  $targetPath = (Resolve-Path $AfterFxPath).Path
  $ae = @(Get-Process AfterFX -ErrorAction SilentlyContinue | Where-Object {
    try { (Resolve-Path $_.Path).Path -eq $targetPath -and $_.Responding -and $_.MainWindowHandle -ne 0 } catch { $false }
  })
  if ($ae.Count -ne 1) { throw "Expected exactly one healthy AfterFX process, found $($ae.Count)." }
  $pid = [int]$ae[0].Id

  $winapp = Get-Command winapp -ErrorAction SilentlyContinue
  if (-not $winapp) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { throw "winapp is not installed and winget is unavailable." }
    & winget install Microsoft.winappcli --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "winget failed to install Microsoft.winappcli (exit $LASTEXITCODE)." }
    $candidate = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\winapp.exe"
    if (Test-Path $candidate) { $winapp = Get-Item $candidate }
    else { $winapp = Get-Command winapp -ErrorAction SilentlyContinue }
  }
  if (-not $winapp) { throw "winapp CLI could not be resolved after installation." }
  $winappExe = if ($winapp.Source) { $winapp.Source } else { $winapp.FullName }

  $status = & $winappExe ui status -a $pid --json 2>&1
  $statusText = ($status | Out-String).Trim()
  Set-Content -Path $statusPath -Value $statusText -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "winapp ui status failed: $statusText" }

  $tree = & $winappExe ui inspect -a $pid --depth 5 2>&1
  $treeText = ($tree | Out-String).Trim()
  Set-Content -Path $treePath -Value $treeText -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "winapp ui inspect failed: $treeText" }

  $shot = & $winappExe ui screenshot -a $pid --output $screenshotPath --json 2>&1
  $shotText = ($shot | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $screenshotPath)) { throw "winapp ui screenshot failed: $shotText" }

  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($screenshotPath)
  try {
    $maxWidth = 960
    $scale = [Math]::Min(1.0, $maxWidth / [double]$img.Width)
    $w = [int][Math]::Round($img.Width * $scale)
    $h = [int][Math]::Round($img.Height * $scale)
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.DrawImage($img, 0, 0, $w, $h) } finally { $g.Dispose() }
    $jpegPath = Join-Path $artifactDir "after-effects-gpt-eye.jpg"
    $bmp.Save($jpegPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    $bytes = [System.IO.File]::ReadAllBytes($jpegPath)
    $b64 = [Convert]::ToBase64String($bytes)
    Write-Output "GPT_EYES_JPEG_BASE64_BEGIN"
    Write-Output $b64
    Write-Output "GPT_EYES_JPEG_BASE64_END"

    Write-Result "PASS" "Captured the live After Effects window and UI tree without modifying or restarting AE." @{
      aePid = $pid
      screenshotWidth = $img.Width
      screenshotHeight = $img.Height
      uiTreeCharacters = $treeText.Length
      winappPath = $winappExe
    }
  } finally { $img.Dispose() }
  exit 0
} catch {
  Write-Result "INFRASTRUCTURE_FAILURE" $_.Exception.Message
  Write-Error $_
  exit 1
}
