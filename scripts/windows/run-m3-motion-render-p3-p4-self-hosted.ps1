param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TemplatePath = Join-Path $RepoRoot "scripts\windows\run-m3-motion-render-self-hosted.ps1"
$TempPath = Join-Path $PSScriptRoot ("run-m3-motion-render-p3-p4-generated-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$DialogHelperPath = Join-Path $RepoRoot "scripts\windows\handle-known-ae-startup-dialog.ps1"
$DialogHelperLog = Join-Path $RepoRoot "proofs\artifacts\m3-motion-render-p3-p4\startup-dialog-handler.log"
$DialogHelperProcess = $null
$PreviousProofFlag = $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF

if (-not (Test-Path $TemplatePath -PathType Leaf)) { throw "Accepted protocol 1.10 P1/P2 self-hosted template is missing: $TemplatePath" }
if (-not (Test-Path $DialogHelperPath -PathType Leaf)) { throw "Guarded After Effects startup-dialog helper is missing: $DialogHelperPath" }
$Template = [System.IO.File]::ReadAllText($TemplatePath)
foreach ($Token in @(
  'run-m3-motion-render-p1-p2.ps1',
  'proofs\artifacts\m3-motion-render-p1-p2',
  'install-editflow-cep-v110-preview.ps1',
  '$MaxPanelRegistrationAttempts = 2',
  'CEP_PANEL_REGISTRATION_TIMEOUT'
)) {
  if (-not $Template.Contains($Token)) { throw "Motion-render P1/P2 self-hosted template drifted; missing guarded token: $Token" }
}

$P34 = $Template.Replace('run-m3-motion-render-p1-p2.ps1', 'run-m3-motion-render-p3-p4.ps1')
$P34 = $P34.Replace('proofs\artifacts\m3-motion-render-p1-p2', 'proofs\artifacts\m3-motion-render-p3-p4')
$P34 = $P34.Replace('motion-render P1/P2', 'motion-render P3/P4')
$P34 = $P34.Replace('Motion-render proof mode:', 'Motion-render P3/P4 proof mode:')
if (-not $P34.Contains('run-m3-motion-render-p3-p4.ps1')) { throw "Generated P3/P4 self-hosted runner did not select the P3/P4 acceptance wrapper." }
if (-not $P34.Contains('install-editflow-cep-v110-preview.ps1')) { throw "Generated P3/P4 self-hosted runner lost the isolated protocol 1.10 preview installer." }
[System.IO.File]::WriteAllText($TempPath, $P34, (New-Object System.Text.UTF8Encoding($false)))

try {
  # The proof-only host injection reads its process environment from After Effects.
  # Arm the flag before the inherited lifecycle launches its owned AE process.
  $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF = "1"

  # The Shadow workstation can present Adobe's crash/recovery dialog before the
  # real project window exists. Start a separate, narrowly scoped watcher that
  # ignores pre-existing AfterFX PIDs and can invoke only an exact Continue
  # button on a visible #32770 dialog whose child text proves recovery context.
  # All candidate controls and any invocation are retained in the proof artifact.
  $DialogWatchSeconds = [Math]::Min(600, [Math]::Max(120, $TimeoutSeconds))
  $DialogArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$DialogHelperPath`" -AfterFxPath `"$AfterFxPath`" -LogPath `"$DialogHelperLog`" -WatchSeconds $DialogWatchSeconds"
  $DialogHelperProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $DialogArguments -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 750
  $DialogHelperProcess.Refresh()
  if ($DialogHelperProcess.HasExited) { throw "Guarded After Effects startup-dialog helper exited before the proof launch." }

  & $TempPath -AfterFxPath $AfterFxPath -TimeoutSeconds $TimeoutSeconds
} finally {
  if ($null -ne $DialogHelperProcess) {
    try {
      $DialogHelperProcess.Refresh()
      if (-not $DialogHelperProcess.HasExited) {
        Stop-Process -Id $DialogHelperProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $DialogHelperProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  if ($null -eq $PreviousProofFlag) { Remove-Item Env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF -ErrorAction SilentlyContinue }
  else { $env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF = $PreviousProofFlag }
  Remove-Item $TempPath -Force -ErrorAction SilentlyContinue
}
