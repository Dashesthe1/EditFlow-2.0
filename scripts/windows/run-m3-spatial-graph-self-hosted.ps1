param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-spatial-graph-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-spatial-graph-p1-p2"
$ResultPath = Join-Path $ProofArtifactDir "result.json"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null
$MaxPanelRegistrationAttempts = 2

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
    "EditFlow M3 spatial-graph CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-RetryablePanelRegistrationFailure {
  if (-not (Test-Path $ResultPath -PathType Leaf)) { return $false }
  try {
    $Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
    $Responses = @($Result.responses)
    $Evidence = @($Result.evidence)
    $CheckProperties = @()
    if ($null -ne $Result.checks) { $CheckProperties = @($Result.checks.PSObject.Properties) }
    return $Result.status -eq "FAILURE" `
      -and $Result.ok -eq $false `
      -and [string]$Result.failureError -match "CEP_PANEL_REGISTRATION_TIMEOUT" `
      -and $null -eq $Result.panel `
      -and $null -eq $Result.environment `
      -and $Responses.Count -eq 0 `
      -and $Evidence.Count -eq 0 `
      -and $CheckProperties.Count -eq 0
  } catch {
    return $false
  }
}

function Retain-PanelRetryEvidence {
  param([int]$Attempt)
  $Destination = Join-Path $ProofArtifactDir ("panel-registration-retry-attempt-" + $Attempt)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($Name in @("result.json", "panel-bootstrap.log", "startup-diagnostics.log", "cep-failure-diagnostics.txt")) {
    $Source = Join-Path $ProofArtifactDir $Name
    if (Test-Path $Source -PathType Leaf) {
      Copy-Item -LiteralPath $Source -Destination (Join-Path $Destination $Name) -Force
    }
  }
  Copy-CepFailureDiagnostics -Destination $Destination
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
  '& $Installer'
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted self-hosted runner template drifted; missing guarded token: $Token"
  }
}

# Protocol 1.9 is intentionally not advertised by the normal installer until its
# real-AE proof is accepted. This block changes only the isolated proof installation:
# it copies the v19 host modules, extends the installed runtime config to 1.9, and
# teaches the installed panel bootstrap to choose current_v19. Repository defaults
# and ordinary EditFlow sessions remain on accepted protocol 1.8.
$PreviewInstallBlock = @'
& $Installer
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$SpatialHostSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_m3_spatial_graph.jsx"
$V19LoaderSource = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_current_v19.jsx"
foreach ($RequiredSource in @($SpatialHostSource, $V19LoaderSource)) {
  if (-not (Test-Path $RequiredSource -PathType Leaf)) { throw "Protocol 1.9 proof host source is missing: $RequiredSource" }
}
Copy-Item $SpatialHostSource (Join-Path $InstalledHost "editflow_host_m3_spatial_graph.jsx") -Force
Copy-Item $V19LoaderSource (Join-Path $InstalledHost "editflow_host_current_v19.jsx") -Force

$BridgePath = Join-Path $InstalledClient "bridge.js"
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV18 = 'var KNOWN_PROTOCOLS = ["1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV18)) { throw "Installed bridge.js protocol list drifted; refusing unverified v19 proof patch." }
if (-not $BridgeText.Contains('editflow_host_current_v18.jsx')) { throw "Installed bridge.js accepted host-loader token drifted." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_18')) { throw "Installed bridge.js accepted host flag token drifted." }
$BridgeText = $BridgeText.Replace($KnownV18, $KnownV19)
$BridgeText = $BridgeText.Replace('editflow_host_current_v18.jsx', 'editflow_host_current_v19.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_19')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)

$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Config.supportedProtocolVersions = @("1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
$ConfigJson = $Config | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)
$RuntimeConfigPath = Join-Path $InstalledClient "runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, ("window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze(" + $CompactConfig + ");`r`n"), $Utf8NoBom)
Write-Host "Isolated protocol 1.9 spatial-graph preview installed for this proof only; normal installer defaults remain accepted protocol 1.8."
'@

$Spatial = $Template
$Spatial = $Spatial.Replace('scripts\windows\run-m3-mask-p1-p2.ps1', 'scripts\windows\run-m3-spatial-graph-p1-p2.ps1')
$Spatial = $Spatial.Replace('proofs\artifacts\m3-mask-p1-p2', 'proofs\artifacts\m3-spatial-graph-p1-p2')
$Spatial = $Spatial.Replace('The M3 mask P1/P2 acceptance runner is missing', 'The M3 spatial-graph P1/P2 acceptance runner is missing')
$Spatial = $Spatial.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.9 preview registration')
$Spatial = $Spatial.Replace('isolated M3 AE proof', 'isolated M3 spatial-graph AE proof')
$Spatial = $Spatial.Replace('& $Installer', $PreviewInstallBlock)
[System.IO.File]::WriteAllText($TempPath, $Spatial, (New-Object System.Text.UTF8Encoding($false)))

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
    throw "Unable to arm CEP 12 verbose logging for the isolated spatial-graph proof. Registry readback was '$EffectiveLogLevel'."
  }
  Write-Host "CEP 12 LogLevel registry readback before AE launch: $EffectiveLogLevel"
  Write-Host "Spatial-graph proof mode: isolated authenticated protocol 1.9 preview; accepted installation remains 1.8 outside this proof."

  $Completed = $false
  for ($Attempt = 1; $Attempt -le $MaxPanelRegistrationAttempts; $Attempt++) {
    $AttemptError = $null
    try {
      & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
      if ($LASTEXITCODE -ne 0) { throw "Spatial-graph generated self-hosted runner exited with code $LASTEXITCODE." }
      $Completed = $true
      break
    } catch {
      $AttemptError = $_
    }

    $RetryableRegistrationFailure = Test-RetryablePanelRegistrationFailure
    if ($Attempt -lt $MaxPanelRegistrationAttempts -and $RetryableRegistrationFailure) {
      $RemainingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
      if ($RemainingAfterFx.Count -ne 0) {
        Retain-PanelRetryEvidence -Attempt $Attempt
        throw "Spatial-graph panel-registration retry refused because the failed zero-command attempt did not return to a zero-After-Effects baseline."
      }
      Retain-PanelRetryEvidence -Attempt $Attempt
      Write-Host ("Authenticated CEP panel registration timed out before any spatial command on attempt " + $Attempt + "; retrying one fresh isolated AE launch from the verified zero-process baseline.")
      Start-Sleep -Seconds 2
      continue
    }

    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    throw $AttemptError
  }

  if (-not $Completed) { throw "Spatial-graph self-hosted runner exhausted its bounded panel-registration attempts." }
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
