param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-temporal-interpolation-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-ease-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-ease-p1-p2"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null

function Copy-CepFailureDiagnostics {
  param([string]$Destination)

  if (-not $env:TEMP -or -not (Test-Path $env:TEMP -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $Cutoff = (Get-Date).AddMinutes(-20)
  $Patterns = @(
    "CEP12-AEFT*.log",
    "CEPHtmlEngine12-AEFT-*.log",
    "CEPHTMLEngine12-AEFT-*.log"
  )
  $Seen = @{}
  $Copied = @()
  foreach ($Pattern in $Patterns) {
    $Candidates = @(Get-ChildItem -Path $env:TEMP -Filter $Pattern -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $Cutoff })
    foreach ($Candidate in $Candidates) {
      if ($Seen.ContainsKey($Candidate.FullName)) { continue }
      $Seen[$Candidate.FullName] = $true
      $Target = Join-Path $Destination $Candidate.Name
      try {
        Copy-Item -LiteralPath $Candidate.FullName -Destination $Target -Force -ErrorAction Stop
        $Copied += $Candidate.Name
      } catch {
        Write-Warning ("Unable to retain CEP diagnostic log {0}: {1}" -f $Candidate.FullName, $_.Exception.Message)
      }
    }
  }

  $ManifestPath = Join-Path $Destination "cep-failure-diagnostics.txt"
  $ManifestLines = @(
    "EditFlow M3 temporal-ease CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) {
    $ManifestLines += $Copied | ForEach-Object { "file=" + $_ }
  } else {
    $ManifestLines += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns."
  }
  [System.IO.File]::WriteAllLines($ManifestPath, $ManifestLines, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted temporal-interpolation self-hosted runner template is missing: $TemplatePath"
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-temporal-interpolation-p1-p2.ps1',
  'proofs\artifacts\m3-temporal-interpolation-p1-p2',
  'authenticated protocol 1.7 registration',
  'isolated M3 temporal-interpolation AE proof',
  'production-equivalent CEP host bootstrap; no direct host-loader preflight'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted temporal-interpolation self-hosted runner template drifted; missing guarded token: $Token"
  }
}

$Ease = $Template
$Ease = $Ease.Replace('scripts\windows\run-m3-temporal-interpolation-p1-p2.ps1', 'scripts\windows\run-m3-temporal-ease-p1-p2.ps1')
$Ease = $Ease.Replace('proofs\artifacts\m3-temporal-interpolation-p1-p2', 'proofs\artifacts\m3-temporal-ease-p1-p2')
$Ease = $Ease.Replace('authenticated protocol 1.7 registration', 'authenticated protocol 1.8 registration')
$Ease = $Ease.Replace('temporal-interpolation P1/P2', 'temporal-ease P1/P2')
$Ease = $Ease.Replace('temporal-interpolation proof', 'temporal-ease proof')
$Ease = $Ease.Replace('temporal-interpolation AE proof', 'temporal-ease AE proof')

# Production proof intentionally does not pass -PreflightHostLoader. The installed
# CEP panel must bootstrap current_v18 through bridge.js exactly as a real session does.
[System.IO.File]::WriteAllText($TempPath, $Ease, (New-Object System.Text.UTF8Encoding($false)))
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
  $EffectiveLogLevel = [string](Get-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction Stop).LogLevel
  if ($EffectiveLogLevel -ne "6") {
    throw "Unable to arm CEP 12 verbose logging for the isolated temporal-ease proof. Registry readback was '$EffectiveLogLevel'."
  }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"
  Write-Host "Temporal-ease proof mode: production-equivalent CEP bootstrap of protocol 1.8; no direct host-loader preload."

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
