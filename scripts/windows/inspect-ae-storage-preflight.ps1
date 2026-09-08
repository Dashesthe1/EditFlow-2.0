param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $OutputPath) {
  $OutputPath = Join-Path $env:TEMP "EditFlow2-ae-storage-preflight.txt"
}
$OutputDir = Split-Path -Parent $OutputPath
if ($OutputDir) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }

$Lines = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$Value) { $Lines.Add($Value) | Out-Null }
function Safe([AllowNull()][string]$Value) {
  if ($null -eq $Value) { return "" }
  return (($Value -replace "[\r\n\t]+", " ").Trim())
}

Add-Line "EditFlow After Effects storage preflight"
Add-Line ("capturedAt=" + (Get-Date).ToUniversalTime().ToString("o"))
Add-Line ("identity=" + [System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
Add-Line ("userProfile=" + (Safe $env:USERPROFILE))
Add-Line ("appData=" + (Safe $env:APPDATA))
Add-Line ("localAppData=" + (Safe $env:LOCALAPPDATA))
Add-Line ""
Add-Line "[logical-disks]"
$Disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Sort-Object DeviceID)
foreach ($Disk in $Disks) {
  $SizeGb = if ($Disk.Size) { [Math]::Round([double]$Disk.Size / 1GB, 2) } else { 0 }
  $FreeGb = if ($Disk.FreeSpace) { [Math]::Round([double]$Disk.FreeSpace / 1GB, 2) } else { 0 }
  Add-Line ("drive={0};sizeGb={1};freeGb={2};volume={3}" -f $Disk.DeviceID, $SizeGb, $FreeGb, (Safe $Disk.VolumeName))
}

Add-Line ""
Add-Line "[after-effects-preference-files]"
$PrefsRoot = Join-Path $env:APPDATA "Adobe\After Effects"
if (-not (Test-Path $PrefsRoot -PathType Container)) {
  Add-Line ("prefsRootMissing=" + $PrefsRoot)
} else {
  $PreferenceFiles = @(Get-ChildItem -LiteralPath $PrefsRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Extension -in @(".txt", ".pref", ".prefs") -or $_.Name -match "Prefs"
  } | Sort-Object FullName)
  foreach ($File in $PreferenceFiles) {
    Add-Line ("file=" + $File.FullName)
    try {
      $RawLines = @(Get-Content -LiteralPath $File.FullName -ErrorAction Stop)
      for ($Index = 0; $Index -lt $RawLines.Count; $Index++) {
        $Line = [string]$RawLines[$Index]
        if ($Line -match "(?i)(disk.?cache|media.?cache|cache.?size|cache.?folder|cache.?path|maximum.?disk|enable.?disk)") {
          $Start = [Math]::Max(0, $Index - 2)
          $End = [Math]::Min($RawLines.Count - 1, $Index + 12)
          for ($ContextIndex = $Start; $ContextIndex -le $End; $ContextIndex++) {
            Add-Line ("  line{0}={1}" -f ($ContextIndex + 1), (Safe ([string]$RawLines[$ContextIndex])))
          }
          Add-Line "  --"
        }
      }
    } catch {
      Add-Line ("  readError=" + (Safe $_.Exception.Message))
    }
  }
}

[System.IO.File]::WriteAllLines($OutputPath, $Lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("AE storage preflight written: " + $OutputPath)
Get-Content -LiteralPath $OutputPath -Raw | Write-Host
