param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-mask-p3-p4-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-layer-controls-p3-p4-self-hosted-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$ProofArtifactDir = Join-Path $RepoRoot "proofs\artifacts\m3-layer-controls-p3-p4"
$DialogWatcher = Join-Path $RepoRoot "scripts\windows\watch-ae-startup-dialogs.ps1"
$DialogDetailsPath = Join-Path $ProofArtifactDir "startup-dialog-details.log"
$CrashRepairHelper = Join-Path $RepoRoot "scripts\windows\continue-known-ae-crash-repair.ps1"
$CrashRepairLog = Join-Path $ProofArtifactDir "crash-repair-recovery.log"
$ProofQuitScript = Join-Path $RepoRoot "scripts\windows\quit-editflow-proof-ae.jsx"
$ProofQuitLog = Join-Path $env:TEMP "EditFlow2-layer-controls-proof-quit.log"
$CsxsKey = "HKCU:\Software\Adobe\CSXS.12"
$OriginalLogLevelPresent = $false
$OriginalLogLevel = $null
$WatcherProcess = $null
$CrashRepairProcess = $null

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
    "EditFlow M3 layer-controls P3/P4 CEP failure diagnostics",
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
if (-not (Test-Path $DialogWatcher -PathType Leaf)) {
  throw "Read-only AE startup-dialog watcher is missing: $DialogWatcher"
}
if (-not (Test-Path $CrashRepairHelper -PathType Leaf)) {
  throw "Exact-state AE Crash Repair Continue helper is missing: $CrashRepairHelper"
}
if (-not (Test-Path $ProofQuitScript -PathType Leaf)) {
  throw "Guarded proof-only AE quit script is missing: $ProofQuitScript"
}
if ($ProofQuitScript -match "\s") {
  throw "The proof-only AE quit script path contains whitespace. The proven AfterFX -r route requires an unquoted workspace path: $ProofQuitScript"
}

# Connector-authored control-branch updates do not always emit a pull_request sync
# event. Run the exact repository validation gate before installing CEP files or AE.
Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed before layer-controls P3/P4 repository validation." }
  }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw "npm run check failed; layer-controls P3/P4 real-AE proof will not launch." }
} finally {
  Pop-Location
}

$Template = [System.IO.File]::ReadAllText($TemplatePath)
$AcceptanceInvocation = '& $Acceptance -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds'
$RequiredTokens = @(
  'scripts\windows\run-m3-mask-p3-p4.ps1',
  'proofs\artifacts\m3-mask-p3-p4',
  'EDITFLOW_M3_MASK_P4_PROOF',
  'authenticated protocol 1.2 registration',
  $AcceptanceInvocation
)
foreach ($Token in $RequiredTokens) {
  if (-not $Template.Contains($Token)) {
    throw "Accepted M3 P3/P4 self-hosted template drifted; missing guarded token: $Token"
  }
}

$LayerControls = $Template
$LayerControls = $LayerControls.Replace('scripts\windows\run-m3-mask-p3-p4.ps1', 'scripts\windows\run-m3-layer-controls-p3-p4.ps1')
$LayerControls = $LayerControls.Replace('proofs\artifacts\m3-mask-p3-p4', 'proofs\artifacts\m3-layer-controls-p3-p4')
$LayerControls = $LayerControls.Replace('EDITFLOW_M3_MASK_P4_PROOF', 'EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF')
$LayerControls = $LayerControls.Replace('authenticated protocol 1.2 registration', 'authenticated protocol 1.6 registration')
$LayerControls = $LayerControls.Replace('M3 mask P3/P4', 'M3 layer-controls P3/P4')
$LayerControls = $LayerControls.Replace('M3 mask/Bezier', 'M3 layer-controls')
$LayerControls = $LayerControls.Replace('isolated M3 AE proof', 'isolated M3 layer-controls AE proof')
$LayerControls = $LayerControls.Replace('The M3 mask P3/P4 acceptance runner is missing', 'The M3 layer-controls P3/P4 acceptance runner is missing')

# A successful proof has already restored a fresh blank unsaved project through the
# exact proof cleanup. Dispatch one fixed JSX that refuses any saved/nonblank project,
# closes only that disposable blank project without saving, and calls app.quit().
# This avoids leaving After Effects to be force-killed after a successful proof, which
# can contaminate the next cold-start with crash/startup-recovery state.
$EscapedProofQuitScript = $ProofQuitScript.Replace("'", "''")
$EscapedProofQuitLog = $ProofQuitLog.Replace("'", "''")
$CleanQuitBlock = @"
& `$Acceptance -AfterFxPath `$AfterFxPath -TimeoutSeconds `$TimeoutSeconds
if (`$LASTEXITCODE -ne 0) { throw "M3 layer-controls P3/P4 acceptance returned a nonzero exit code before clean shutdown." }
`$EditFlowProofQuitScript = '$EscapedProofQuitScript'
`$EditFlowProofQuitLog = '$EscapedProofQuitLog'
if (Test-Path `$EditFlowProofQuitLog -PathType Leaf) { Remove-Item `$EditFlowProofQuitLog -Force }
Write-StartupDiagnostic "PROOF_CLEAN_QUIT_DISPATCH" ("script=" + `$EditFlowProofQuitScript)
`$ProofQuitProcess = Start-Process -FilePath `$AfterFxPath -ArgumentList @("-r", `$EditFlowProofQuitScript) -PassThru
`$ProofQuitDeadline = (Get-Date).AddSeconds(20)
`$ProofQuitApproved = `$false
while ((Get-Date) -lt `$ProofQuitDeadline) {
  `$ProofQuitText = ""
  if (Test-Path `$EditFlowProofQuitLog -PathType Leaf) {
    try { `$ProofQuitText = Get-Content `$EditFlowProofQuitLog -Raw } catch { `$ProofQuitText = "" }
  }
  if (`$ProofQuitText -match "QUIT_REFUSED") {
    Write-StartupDiagnostic "PROOF_CLEAN_QUIT_REFUSED" (ConvertTo-SingleLineDiagnostic `$ProofQuitText)
    throw "The guarded proof-only After Effects quit script refused shutdown."
  }
  `$RemainingAfterFx = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if (`$ProofQuitText -match "QUIT_APPROVED" -and `$RemainingAfterFx.Count -eq 0) {
    `$ProofQuitApproved = `$true
    break
  }
  Start-Sleep -Milliseconds 250
}
if (-not `$ProofQuitApproved) {
  `$RemainingIds = (@(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue) | ForEach-Object { `$_.Id }) -join ","
  Write-StartupDiagnostic "PROOF_CLEAN_QUIT_TIMEOUT" ("remainingPids=" + `$RemainingIds)
  throw "The successful proof did not achieve guarded scripted After Effects shutdown within 20 seconds."
}
Write-StartupDiagnostic "PROOF_CLEAN_QUIT_CONFIRMED" "aeCount=0"
"@
$LayerControls = $LayerControls.Replace($AcceptanceInvocation, $CleanQuitBlock.TrimEnd())
[System.IO.File]::WriteAllText($TempPath, $LayerControls, (New-Object System.Text.UTF8Encoding($false)))

# Proof flags are process-global to the isolated AE child. Preserve shell values,
# clear unrelated M3 proof modes, and let the generated accepted template arm only
# protocol-1.6 layer-controls P4. Crash-repair Continue is a runner-only environment
# normalization gate and is never interpreted by the AE host adapter.
$ProofEnvNames = @(
  "EDITFLOW_M3_MASK_P4_PROOF",
  "EDITFLOW_M3_COMPOSITE_P4_PROOF",
  "EDITFLOW_M3_PARENTING_P4_PROOF",
  "EDITFLOW_M3_NULL_RIG_P4_PROOF",
  "EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF",
  "EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE"
)
$OriginalProofEnv = @{}
foreach ($Name in $ProofEnvNames) {
  $OriginalProofEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
  Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue
}

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

  New-Item -ItemType Directory -Force -Path $ProofArtifactDir | Out-Null
  if (Test-Path $DialogDetailsPath -PathType Leaf) { Remove-Item $DialogDetailsPath -Force }
  if (Test-Path $CrashRepairLog -PathType Leaf) { Remove-Item $CrashRepairLog -Force }

  # Run 7 proved that the recurring blocker is AE 25.6 Crash Repair Options and
  # retained pixels show Continue as the already-focused default action. Start a
  # separate, exact-signature sidecar before cold launch. It may send one Enter only
  # when a newly launched runner-owned AfterFX process matches that retained window
  # signature; every other dialog remains untouched and the base runner fails closed.
  $RecoveryStartedAfterUtc = (Get-Date).ToUniversalTime()
  $env:EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE = "1"
  $RecoveryArgs = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $CrashRepairHelper + '"'),
    "-AfterFxPath", ('"' + $AfterFxPath + '"'),
    "-OutputPath", ('"' + $CrashRepairLog + '"'),
    "-StartedAfterUtc", $RecoveryStartedAfterUtc.ToString("o"),
    "-DurationSeconds", [Math]::Min(300, [Math]::Max(140, $TimeoutSeconds + 60)),
    "-PollMilliseconds", 250
  )
  $CrashRepairProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $RecoveryArgs -PassThru -WindowStyle Hidden

  $WatcherArgs = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $DialogWatcher,
    "-OutputPath", $DialogDetailsPath,
    "-DurationSeconds", [Math]::Min(300, [Math]::Max(140, $TimeoutSeconds + 60)),
    "-PollMilliseconds", 2000
  )
  $WatcherProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $WatcherArgs -PassThru -WindowStyle Hidden

  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
  if ($LASTEXITCODE -ne 0) {
    Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
    exit $LASTEXITCODE
  }
} catch {
  Copy-CepFailureDiagnostics -Destination $ProofArtifactDir
  throw
} finally {
  if ($null -ne $CrashRepairProcess) {
    try {
      $CrashRepairProcess.Refresh()
      if (-not $CrashRepairProcess.HasExited) {
        Stop-Process -Id $CrashRepairProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $CrashRepairProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  if ($null -ne $WatcherProcess) {
    try {
      $WatcherProcess.Refresh()
      if (-not $WatcherProcess.HasExited) {
        Stop-Process -Id $WatcherProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $WatcherProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  if ($OriginalLogLevelPresent) {
    New-ItemProperty -Path $CsxsKey -Name "LogLevel" -PropertyType String -Value $OriginalLogLevel -Force -ErrorAction SilentlyContinue | Out-Null
  } else {
    Remove-ItemProperty -Path $CsxsKey -Name "LogLevel" -ErrorAction SilentlyContinue
  }
  foreach ($Name in $ProofEnvNames) {
    $OriginalValue = $OriginalProofEnv[$Name]
    if ($null -ne $OriginalValue) { [Environment]::SetEnvironmentVariable($Name, [string]$OriginalValue, "Process") }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
  }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
