param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [string]$ProjectPath = "C:\Users\Shadow\Downloads\Open Template.aep"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $AfterFxPath -PathType Leaf)) { throw "AfterFX.exe was not found: $AfterFxPath" }
if (-not (Test-Path $ProjectPath -PathType Leaf)) { throw "Open Template project was not found: $ProjectPath" }

$ResolvedAfterFx = (Resolve-Path $AfterFxPath).Path
$ResolvedProject = (Resolve-Path $ProjectPath).Path
$Existing = @(Get-Process AfterFX -ErrorAction SilentlyContinue | Where-Object {
  try { [StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $_.Path).Path, $ResolvedAfterFx) } catch { $false }
})
if ($Existing.Count -gt 1) { throw "More than one target After Effects process is running." }
if ($Existing.Count -eq 1) {
  [pscustomobject]@{ status = "REUSED"; pid = $Existing[0].Id; projectPath = $ResolvedProject }
  exit 0
}

$ArgumentList = '"' + $ResolvedProject + '"'
$Process = Start-Process -FilePath $ResolvedAfterFx -ArgumentList $ArgumentList -PassThru
[pscustomobject]@{ status = "LAUNCHED_TEMPLATE"; pid = $Process.Id; projectPath = $ResolvedProject }
