param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [Parameter(Mandatory = $true)]
  [string]$AcceptedP1P2Path,
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-marker-motion-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-marker-motion-p3-p4"
$DialogWatcher = Join-Path $RepoRoot "scripts\windows\watch-ae-startup-dialogs.ps1"
$DialogDetailsPath = Join-Path $ProofArtifactDir "startup-dialog-details.log"
$ProofQuitScript = Join-Path $RepoRoot "scripts\windows\quit-editflow-proof-ae.jsx"
$ProofQuitLog = Join-Path $env:TEMP "EditFlow2-marker-motion-proof-quit.log"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null
$WatcherProcess = $null
$AcceptedEnvName = "EDITFLOW_M3_MARKER_MOTION_ACCEPTED_P1_P2"

function Copy-CepFailureDiagnostics {
  param([string]$Destination)
  if (-not $env:TEMP -or -not (Test-Path $env:TEMP -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $Cutoff = (Get-Date).AddMinutes(-20)
  $Patterns = @("CEP12-AEFT*.log", "CEPHtmlEngine12-AEFT-*.log", "CEPHTMLEngine12-AEFT-*.log")
  $Seen = @{}
  $Copied = @()
  foreach ($Pattern in $Patterns) {
    $Candidates = @(Get-ChildItem -Path $env:TEMP -Filter $Pattern -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $Cutoff })
    foreach ($Candidate in $Candidates) {
      if ($Seen.ContainsKey($Candidate.FullName)) { continue }
      $Seen[$Candidate.FullName] = $true
      try {
        Copy-Item -LiteralPath $Candidate.FullName -Destination (Join-Path $Destination $Candidate.Name) -Force -ErrorAction Stop
        $Copied += $Candidate.Name
      } catch { Write-Warning ("Unable to retain CEP diagnostic log {0}: {1}" -f $Candidate.FullName, $_.Exception.Message) }
    }
  }
  $Manifest = @(
    "EditFlow M3 marker-motion P3/P4 CEP failure diagnostics",
    ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o")),
    ("sourceTemp=" + $env:TEMP),
    ("filesCopied=" + $Copied.Count)
  )
  if ($Copied.Count -gt 0) { $Manifest += $Copied | ForEach-Object { "file=" + $_ } }
  else { $Manifest += "note=No recent CEP12/CEPHtmlEngine AEFT log matched the documented Windows log patterns." }
  [System.IO.File]::WriteAllLines((Join-Path $Destination "cep-failure-diagnostics.txt"), $Manifest, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted M3 mask P3/P4 self-hosted runner template is missing: $TemplatePath" }
if (-not (Test-Path $AcceptedP1P2Path -PathType Leaf)) { throw "Accepted marker-motion P1/P2 artifact is missing: $AcceptedP1P2Path" }
$AcceptedP1P2Path = (Resolve-Path $AcceptedP1P2Path).Path
if (-not (Test-Path $DialogWatcher -PathType Leaf)) { throw "Read-only AE startup-dialog watcher is missing: $DialogWatcher" }
if (-not (Test-Path $ProofQuitScript -PathType Leaf)) { throw "Guarded proof-only AE quit script is missing: $ProofQuitScript" }
if ($ProofQuitScript -match "\s") { throw "The proof-only AE quit script path contains whitespace: $ProofQuitScript" }

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before marker-motion P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; marker-motion P3/P4 real-AE proof will not launch." }
} finally { Pop-Location }

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$AcceptanceInvocation = '& $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds'
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  '& $Installer',
  $AcceptanceInvocation
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) { throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token" }
}

$MarkerMotion = $Template
$MarkerMotion = $MarkerMotion.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-marker-motion-p3-p4.ps1')
$MarkerMotion = $MarkerMotion.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-marker-motion-p3-p4')
$MarkerMotion = $MarkerMotion.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_MARKER_MOTION_P4_PROOF')
$MarkerMotion = $MarkerMotion.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 2.0 preview registration')
$MarkerMotion = $MarkerMotion.Replace('M3 mask P3/P4', 'M3 marker-motion P3/P4')
$MarkerMotion = $MarkerMotion.Replace('M3 mask/Bezier', 'M3 marker-motion/shutter')
$MarkerMotion = $MarkerMotion.Replace('isolated M3 AE proof', 'isolated M3 marker-motion AE proof')
$MarkerMotion = $MarkerMotion.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 marker-motion P3/P4 acceptance runner is missing')

# Protocol 2.0 is not promoted by the normal installer yet. Patch only the proof
# installation after running the accepted installer; repository/default sessions
# remain on accepted protocol 1.9.
$PreviewInstallBlock = @'
& $Installer
$InstalledRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.editflow2.bridge"
$InstalledHost = Join-Path $InstalledRoot "host"
$InstalledClient = Join-Path $InstalledRoot "client"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Protocol20Files = @(
  "editflow_host_m3_marker_motion.jsx",
  "editflow_host_m3_marker_motion_atomicity.jsx",
  "editflow_host_m3_marker_motion_proof_cleanup.jsx",
  "editflow_host_current_v20.jsx"
)
foreach ($FileName in $Protocol20Files) {
  $SourcePath = Join-Path $RepoRoot ("packages\adapters\ae-cep\host\" + $FileName)
  if (-not (Test-Path $SourcePath -PathType Leaf)) { throw "Protocol 2.0 proof host file is missing: $SourcePath" }
  Copy-Item -LiteralPath $SourcePath -Destination (Join-Path $InstalledHost $FileName) -Force
}
$BridgePath = Join-Path $InstalledClient "bridge.js"
$BridgeText = [System.IO.File]::ReadAllText($BridgePath)
$KnownV19 = 'var KNOWN_PROTOCOLS = ["1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
$KnownV20 = 'var KNOWN_PROTOCOLS = ["2.0.0","1.9.0","1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0"];'
if (-not $BridgeText.Contains($KnownV19)) { throw "Installed bridge.js protocol list drifted; refusing unverified v20 proof patch." }
if (-not $BridgeText.Contains('editflow_host_current_v19.jsx')) { throw "Installed bridge.js accepted host-loader token drifted." }
if (-not $BridgeText.Contains('EditFlow2_HOST_PROTOCOL_19')) { throw "Installed bridge.js accepted host flag token drifted." }
$BridgeText = $BridgeText.Replace($KnownV19, $KnownV20)
$BridgeText = $BridgeText.Replace('editflow_host_current_v19.jsx', 'editflow_host_current_v20.jsx')
$BridgeText = $BridgeText.Replace('EditFlow2_HOST_PROTOCOL_19', 'EditFlow2_HOST_PROTOCOL_20')
[System.IO.File]::WriteAllText($BridgePath, $BridgeText, $Utf8NoBom)
$ConfigPath = Join-Path $env:LOCALAPPDATA "EditFlow2\bridge-config.json"
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Config.supportedProtocolVersions = @("2.0.0", "1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0")
$ConfigJson = $Config | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($ConfigPath, $ConfigJson + [Environment]::NewLine, $Utf8NoBom)
$RuntimeConfigPath = Join-Path $InstalledClient "runtime-config.js"
$CompactConfig = $Config | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($RuntimeConfigPath, ("window.EDITFLOW2_BRIDGE_CONFIG = Object.freeze(" + $CompactConfig + ");`r`n"), $Utf8NoBom)
Write-Host "Isolated protocol 2.0 marker-motion P3/P4 preview installed; normal installer defaults remain accepted protocol 1.9."
'@
$MarkerMotion = $MarkerMotion.Replace('& $Installer', $PreviewInstallBlock.TrimEnd())

$EscapedProofQuitScript = $ProofQuitScript.Replace("'", "''")
$EscapedProofQuitLog = $ProofQuitLog.Replace("'", "''")
$AcceptanceWithDependency = '& $Acceptance -AfterFxPath $AfterFxPath -AcceptedP1P2Path $env:' + $AcceptedEnvName + ' -TimeoutSeconds $TimeoutSeconds'
$CleanQuitBlock = @"
$AcceptanceWithDependency
if (`$LASTEXITCODE -ne 0) { throw "M3 marker-motion P3/P4 acceptance returned a nonzero exit code before clean shutdown." }
`$EditFlowProofQuitScript = '$EscapedProofQuitScript'
`$EditFlowProofQuitLog = '$EscapedProofQuitLog'
if (Test-Path `$EditFlowProofQuitLog -PathType Leaf) { Remove-Item `$EditFlowProofQuitLog -Force }
Write-StartupDiagnostic "PROOF_CLEAN_QUIT_DISPATCH" ("script=" + `$EditFlowProofQuitScript)
`$ProofQuitProcess = Start-Process -FilePath `$AfterFxPath -ArgumentList @("-r", `$EditFlowProofQuitScript) -PassThru
`$ProofQuitDeadline = (Get-Date).AddSeconds(20)
`$ProofQuitApproved = `$false
while ((Get-Date) -lt `$ProofQuitDeadline) {
  `$ProofQuitText = ""
  if (Test-Path `$EditFlowProofQuitLog -PathType Leaf) { try { `$ProofQuitText = Get-Content `$EditFlowProofQuitLog -Raw } catch { `$ProofQuitText = "" } }
  if (`$ProofQuitText -match "QUIT_REFUSED") { Write-StartupDiagnostic "PROOF_CLEAN_QUIT_REFUSED" (ConvertTo-SingleLineDiagnostic `$ProofQuitText); throw "The guarded proof-only After Effects quit script refused shutdown." }
  `$RemainingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if (`$ProofQuitText -match "QUIT_APPROVED" -and `$RemainingAfterFx.Count -eq 0) { `$ProofQuitApproved = `$true; break }
  Start-Sleep -Milliseconds 250
}
if (-not `$ProofQuitApproved) {
  `$RemainingIds = (@(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue) | ForEach-Object { `$_.Id }) -join ","
  Write-StartupDiagnostic "PROOF_CLEAN_QUIT_TIMEOUT" ("remainingPids=" + `$RemainingIds)
  throw "The successful proof did not achieve guarded scripted After Effects shutdown within 20 seconds."
}
Write-StartupDiagnostic "PROOF_CLEAN_QUIT_CONFIRMED" "aeCount=0"
"@
$MarkerMotion = $MarkerMotion.Replace($AcceptanceInvocation, $CleanQuitBlock.TrimEnd())
[System.IO.File]::WriteAllText($TempPath, $MarkerMotion, (New-Object System.Text.UTF8Encoding($false)))

$ProofEnvNames = @(
  "EDITFLOW_M3_MASK_P4_PROOF",
  "EDITFLOW_M3_COMPOSITE_P4_PROOF",
  "EDITFLOW_M3_PARENTING_P4_PROOF",
  "EDITFLOW_M3_NULL_RIG_P4_PROOF",
  "EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF",
  "EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF",
  "EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF",
  "EDITFLOW_M3_MARKER_MOTION_P4_PROOF",
  $AcceptedEnvName
)
$OriginalProofEnv = @{}
foreach ($Name in $ProofEnvNames) {
  $OriginalProofEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
  Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
}
[Environment]::SetEnvironmentVariable($AcceptedEnvName, $AcceptedP1P2Path, "Process")

try {
  New-Item -Path $CsxsKey -Force | Out-Null
  try {
    $ExistingCsxs = Get-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction Stop
    $OriginalLogLevelPresent = $true
    $OriginalLogLevel = [string]$ExistingCsxs.LogLevel
  } catch { $OriginalLogLevelPresent = $false }
  New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value "6" -Force | Out-Null

  New-Item -ItemType Directory -Force -Path $ProofArtifactDir | Out-Null
  if (Test-Path $DialogDetailsPath -PathType Leaf) { Remove-Item $DialogDetailsPath -Force }
  $WatcherArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $DialogWatcher, "-OutputPath", $DialogDetailsPath, "-DurationSeconds", [Math]::Min(420, [Math]::Max(180, $TimeoutSeconds + 90)), "-PollMilliseconds", 2000)
  $WatcherProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $WatcherArgs -PassThru -WindowStyle Hidden

  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) { Copy-CepFailureDiagnostics -Destination $ProofArtifactDir; exit $LASTEXITCODE }
} catch {
  Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
  throw
} finally {
  if ($null -ne $WatcherProcess) {
    try {
      $WatcherProcess.Refresh()
      if (-not $WatcherProcess.HasExited) { Stop-Process -Id $WatcherProcess.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $WatcherProcess.Id -Timeout 5 -ErrorAction SilentlyContinue }
    } catch {}
  }
  if ($OriginalLogLevelPresent) { New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value $OriginalLogLevel -Force -ErrorAction SilentlyContinue | Out-Null }
  else { Remove-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction SilentlyContinue }
  foreach ($Name in $ProofEnvNames) {
    $OriginalValue = $OriginalProofEnv[$Name]
    if ($null -ne $OriginalValue) { [Environment]::SetEnvironmentVariable($Name, [string]$OriginalValue, "Process") }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
  }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
