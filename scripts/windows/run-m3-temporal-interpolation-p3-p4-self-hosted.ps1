param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-temporal-interpolation-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-temporal-interpolation-p3-p4"
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
    "EditFlow M3 temporal-interpolation P3/P4 CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) {
  throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath"
}

# A control-branch push can bypass the PR synchronization event, so prove the exact
# checkout is healthy before installing CEP files or launching After Effects.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before temporal P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; temporal P3/P4 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  'The M3 mask P3/P4 acceptance runner is missing'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

$Temporal = $Template
$Temporal = $Temporal.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-temporal-interpolation-p3-p4.ps1')
$Temporal = $Temporal.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-temporal-interpolation-p3-p4')
$Temporal = $Temporal.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF')
$Temporal = $Temporal.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.7 registration')
$Temporal = $Temporal.Replace('M3 mask P3/P4', 'M3 temporal-interpolation P3/P4')
$Temporal = $Temporal.Replace('M3 mask/Bezier', 'M3 temporal-interpolation')
$Temporal = $Temporal.Replace('isolated M3 AE proof', 'isolated M3 temporal-interpolation AE proof')
$Temporal = $Temporal.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 temporal-interpolation P3/P4 acceptance runner is missing')
[System.IO.File]::WriteAllText($TempPath, $Temporal, (New-Object System.Text.UTF8Encoding($false)))

# Adobe CEP 12 LogLevel is process-start scoped. Arm it before the generated template
# launches the isolated AE process, preserve the user's prior registry value, and
# retain recent CEP logs only on failure.
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
  if ($EffectiveLogLevel -ne "6") { throw "Unable to arm CEP 12 verbose logging for temporal P3/P4 proof." }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"

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
