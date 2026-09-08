param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-motion-render-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-motion-render-p1-p2"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null

function Copy-CepFailureDiagnostics {
  param([string]$Destination)

  if (-not $env:TEMP -or -not (Test-Path $env:TEMP -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $Cutoff = (Get-Date).AddMinutes(-20)
  $Patterns = @("CEP12-AEFT*.log", "CEPHtmlEngine12-AEFT-*.log", "CEPHTMLEngine12-AEFT-*.log")
  $Seen = @{}
  $Copied = @()
  foreach ($Pattern in $Patterns) {
    $Candidates = @(Get-ChildItem -Path $env:TEMP -Filter $Pattern -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $Cutoff })
    foreach ($Candidate in $Candidates) {
      if ($Seen.ContainsKey($Candidate.FullName)) { continue }
      $Seen[$Candidate.FullName] = $true
      try {
        Copy-Item -LiteralPath $Candidate.FullName -Destination (Join-Path $Destination $Candidate.Name) -Force -ErrorAction Stop
        $Copied += $Candidate.Name
      } catch {
        Write-Warning ("Unable to retain CEP diagnostic log {0}: {1}" -f $Candidate.FullName, $_.Exception.Message)
      }
    }
  }
  $Manifest = @(
    "EditFlow M3 motion-render CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 P1/P2 self-hosted runner template is missing: $TemplatePath"
}
$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p1-p2.ps1',
  'proofs\artifacts\m3-mask-p1-p2',
  'The M3 mask P1/P2 acceptance runner is missing',
  'authenticated protocol 1.2 registration',
  'scripts\windows\install-editflow-cep.ps1'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$MotionRender = $Template
$MotionRender = $MotionRender.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-motion-render-p1-p2.ps1')
$MotionRender = $MotionRender.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-motion-render-p1-p2')
$MotionRender = $MotionRender.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 motion-render P1/P2 acceptance runner is missing')
$MotionRender = $MotionRender.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.10 preview registration')
$MotionRender = $MotionRender.Replace('isolated M3 AE proof', 'isolated M3 motion-render AE proof')
$MotionRender = $MotionRender.Replace('scripts\windows\install-editflow-cep.ps1', 'scripts\windows\install-editflow-cep-v110-preview.ps1')

if (-not $MotionRender.Contains('scripts\windows\install-editflow-cep-v110-preview.ps1')) {
  throw "Generated motion-render self-hosted runner did not select the isolated protocol 1.10 preview installer."
}
[System.IO.File]::WriteAllText($TempPath, $MotionRender, (New-Object System.Text.UTF8Encoding($false)))

try {
  New-Item -Path $CsxsKey -Force | Out-Null
  try {
    $ExistingCsxs = Get-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction Stop
    $OriginalLogLevelPresent = $true
    $OriginalLogLevel = [string]$ExistingCsxs.LogLevel
  } catch {
    $OriginalLogLevelPresent = $false
  }
  New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value "6" -Force | Out-Null
  Write-Host "Motion-render proof mode: isolated authenticated protocol 1.10 preview; accepted production runtime remains protocol 1.9."

  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) {
    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    exit $LASTEXITCODE
  }
} catch {
  Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
  throw
} finally {
  if ($OriginalLogLevelPresent) {
    New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value $OriginalLogLevel -Force -ErrorAction SilentlyContinue | Out-Null
  } else {
    Remove-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction SilentlyContinue
  }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
