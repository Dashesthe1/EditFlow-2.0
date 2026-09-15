param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 8
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PreflightScript = Join-Path $RepoRoot "scripts\windows\m5-roto-brush-proof-preflight.jsx"
$Marker = Join-Path $env:TEMP "EditFlow2-m5-roto-brush-preflight.json"
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "After Effects executable not found: $AfterFxPath" }
if (-not (Test-Path $PreflightScript -PathType Leaf)) { throw "M5 Roto Brush preflight script missing: $PreflightScript" }
$Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
if ($Running.Count -ne 1) { throw "M5 Roto Brush proof preflight requires exactly one already-running After Effects process; found $($Running.Count). No AE lifecycle action was attempted." }
if (-not $Running[0].Responding -or $Running[0].MainWindowHandle -eq 0) { throw "The existing After Effects process is not a responsive visible proof target. No AE lifecycle action was attempted." }
Remove-Item $Marker -Force -ErrorAction SilentlyContinue
$Dispatch = Start-Process -FilePath $AfterFxPath -ArgumentList @("-r", $PreflightScript) -PassThru
$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $Marker -PathType Leaf)) {
  if ((Get-Date) -ge $Deadline) { throw "M5 Roto Brush read-only preflight timed out; development host load and interactive actions remain forbidden." }
  Start-Sleep -Milliseconds 100
}
$Result = Get-Content $Marker -Raw | ConvertFrom-Json
if ($Result.version -ne "M5_ROTO_BRUSH_PREFLIGHT_V1") { throw "M5 Roto Brush preflight marker version mismatch." }
$Summary = [ordered]@{
  eligible = [bool]$Result.eligible
  refusalCode = $Result.refusalCode
  safeToLoadDevelopmentHost = [bool]$Result.safeToLoadDevelopmentHost
  safeToIssueInteractiveActions = [bool]$Result.safeToIssueInteractiveActions
  state = $Result.state
  existingAfterFxId = $Running[0].Id
  dispatchProcessId = $Dispatch.Id
}
$Summary | ConvertTo-Json -Depth 5 | Write-Output
if (-not $Result.eligible) { throw "M5 Roto Brush proof preflight refused: $($Result.refusalCode). Protocol 2.6 host loading and interactive proof actions are blocked." }
if (-not $Result.safeToLoadDevelopmentHost -or -not $Result.safeToIssueInteractiveActions) { throw "M5 Roto Brush proof preflight returned an internally inconsistent allow decision." }