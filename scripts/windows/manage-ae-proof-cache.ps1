param(
  [ValidateSet("Prepare", "Restore")]
  [string]$Mode,
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [Parameter(Mandatory = $true)]
  [string]$StatePath,
  [Parameter(Mandatory = $true)]
  [string]$EvidencePath,
  [int]$RestoreWaitSeconds = 30
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$CacheNamespace = "EditFlow2\AfterEffectsDiskCache"
$SafetyBufferGb = 5.0

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Write-JsonFile([string]$Path, $Value) {
  $Parent = Split-Path -Parent $Path
  if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
  $Json = $Value | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($Path, $Json + [Environment]::NewLine, $Utf8NoBom)
}

function Wait-ForAfterFxExit([int]$Seconds) {
  $Deadline = (Get-Date).AddSeconds([Math]::Max(0, $Seconds))
  do {
    $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
    if ($Running.Count -eq 0) { return }
    if ((Get-Date) -ge $Deadline) {
      $Ids = ($Running | ForEach-Object { $_.Id }) -join ","
      throw "AE_CACHE_GUARD_ACTIVE_AFTERFX: refusing preference mutation while After Effects is running (pids=$Ids)."
    }
    Start-Sleep -Milliseconds 250
  } while ($true)
}

function Get-TextEncoding([byte[]]$Bytes) {
  if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
    return @{ Encoding = New-Object System.Text.UTF8Encoding($true); Preamble = 3 }
  }
  if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
    return @{ Encoding = New-Object System.Text.UnicodeEncoding($false, $true); Preamble = 2 }
  }
  if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
    return @{ Encoding = New-Object System.Text.UnicodeEncoding($true, $true); Preamble = 2 }
  }
  return @{ Encoding = New-Object System.Text.UTF8Encoding($false); Preamble = 0 }
}

function Read-PreferenceDocument([string]$Path) {
  $Bytes = [System.IO.File]::ReadAllBytes($Path)
  $EncodingInfo = Get-TextEncoding $Bytes
  $Preamble = [int]$EncodingInfo.Preamble
  $PayloadLength = $Bytes.Length - $Preamble
  $Text = if ($PayloadLength -gt 0) { $EncodingInfo.Encoding.GetString($Bytes, $Preamble, $PayloadLength) } else { "" }
  return @{ Bytes = $Bytes; Text = $Text; Encoding = $EncodingInfo.Encoding; HasBom = ($Preamble -gt 0) }
}

function Write-PreferenceDocument([string]$Path, [string]$Text, $Encoding, [bool]$HasBom) {
  $Body = $Encoding.GetBytes($Text)
  $Preamble = if ($HasBom) { $Encoding.GetPreamble() } else { [byte[]]@() }
  $Combined = New-Object byte[] ($Preamble.Length + $Body.Length)
  if ($Preamble.Length -gt 0) { [Array]::Copy($Preamble, 0, $Combined, 0, $Preamble.Length) }
  if ($Body.Length -gt 0) { [Array]::Copy($Body, 0, $Combined, $Preamble.Length, $Body.Length) }
  [System.IO.File]::WriteAllBytes($Path, $Combined)
}

function Get-PrefsVersion([string]$Executable) {
  if (-not (Test-Path $Executable -PathType Leaf)) { throw "AfterFX.exe not found: $Executable" }
  $ProductVersion = [string](Get-Item $Executable).VersionInfo.ProductVersion
  $Match = [regex]::Match($ProductVersion, '^(\d+)\.(\d+)')
  if (-not $Match.Success) { throw "Unable to derive AE major.minor preference version from ProductVersion '$ProductVersion'." }
  return @{ ProductVersion = $ProductVersion; PrefsVersion = ($Match.Groups[1].Value + "." + $Match.Groups[2].Value) }
}

function Get-DiskCacheSettings([string]$Text) {
  $NewLine = if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $Lines = [regex]::Split($Text, "\r?\n")
  $SectionIndexes = New-Object System.Collections.Generic.List[int]
  for ($Index = 0; $Index -lt $Lines.Length; $Index++) {
    if ($Lines[$Index] -eq '["Disk Cache Controls"]') { $SectionIndexes.Add($Index) }
  }
  if ($SectionIndexes.Count -ne 1) { throw "AE_CACHE_GUARD_SECTION_AMBIGUOUS: expected exactly one [\"Disk Cache Controls\"] section; found $($SectionIndexes.Count)." }
  $Start = $SectionIndexes[0]
  $End = $Lines.Length
  for ($Index = $Start + 1; $Index -lt $Lines.Length; $Index++) {
    if ($Lines[$Index] -match '^\[.*\]$') { $End = $Index; break }
  }
  $FolderIndexes = @()
  $MaxIndexes = @()
  for ($Index = $Start + 1; $Index -lt $End; $Index++) {
    if ($Lines[$Index] -match '^"Folder 7"\s*=\s*"([^"]*)"\s*$') { $FolderIndexes += $Index }
    if ($Lines[$Index] -match '^"Max Size 3"\s*=\s*"([0-9]+(?:\.[0-9]+)?)"\s*$') { $MaxIndexes += $Index }
  }
  if ($FolderIndexes.Count -ne 1) { throw "AE_CACHE_GUARD_FOLDER_KEY_AMBIGUOUS: expected exactly one Folder 7 key; found $($FolderIndexes.Count)." }
  if ($MaxIndexes.Count -ne 1) { throw "AE_CACHE_GUARD_MAX_KEY_AMBIGUOUS: expected exactly one Max Size 3 key; found $($MaxIndexes.Count)." }
  $FolderLine = $Lines[$FolderIndexes[0]]
  $MaxLine = $Lines[$MaxIndexes[0]]
  $FolderMatch = [regex]::Match($FolderLine, '^"Folder 7"\s*=\s*"([^"]*)"\s*$')
  $MaxMatch = [regex]::Match($MaxLine, '^"Max Size 3"\s*=\s*"([0-9]+(?:\.[0-9]+)?)"\s*$')
  $ReserveMatch = [regex]::Matches($Text, '(?m)^"Minimum Volume Free Space \(Gigabytes\)"\s*=\s*"([0-9]+(?:\.[0-9]+)?)"\s*$')
  if ($ReserveMatch.Count -ne 1) { throw "AE_CACHE_GUARD_RESERVE_KEY_AMBIGUOUS: expected exactly one Minimum Volume Free Space (Gigabytes) key; found $($ReserveMatch.Count)." }
  return @{
    Lines = $Lines
    NewLine = $NewLine
    FolderIndex = [int]$FolderIndexes[0]
    Folder = $FolderMatch.Groups[1].Value
    MaxSizeGb = [double]::Parse($MaxMatch.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    ReserveGb = [double]::Parse($ReserveMatch[0].Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
  }
}

function Get-DriveForPath([string]$PathValue) {
  if (-not $PathValue -or $PathValue.Length -lt 2 -or $PathValue[1] -ne ':') { return $null }
  return $PathValue.Substring(0, 2).ToUpperInvariant()
}

function Build-Evidence($State, [string]$Status, [string]$RestoredSha256 = "") {
  return [ordered]@{
    schemaVersion = 1
    proof = "M3_MARKER_MOTION_P3_P4_AE_CACHE_GUARD"
    status = $Status
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    productVersion = $State.productVersion
    prefsVersion = $State.prefsVersion
    prefsPath = $State.prefsPath
    originalPrefsSha256 = $State.originalPrefsSha256
    restoredPrefsSha256 = if ($RestoredSha256) { $RestoredSha256 } else { $null }
    originalCacheFolder = $State.originalCacheFolder
    temporaryCacheFolder = $State.temporaryCacheFolder
    maxSizeGb = $State.maxSizeGb
    reserveGb = $State.reserveGb
    safetyBufferGb = $State.safetyBufferGb
    selectedDrive = $State.selectedDrive
    selectedDriveFreeGb = $State.selectedDriveFreeGb
    changed = $State.changed
    preferencesRestored = ($Status -eq "RESTORED")
    warningPreferenceModified = $false
  }
}

if ($Mode -eq "Prepare") {
  Wait-ForAfterFxExit 0
  if (Test-Path $StatePath -PathType Leaf) { throw "AE_CACHE_GUARD_STATE_EXISTS: refusing Prepare because state already exists: $StatePath" }

  $Version = Get-PrefsVersion $AfterFxPath
  $PrefsPath = Join-Path $env:APPDATA ("Adobe\After Effects\{0}\Adobe After Effects {0} Prefs.txt" -f $Version.PrefsVersion)
  if (-not (Test-Path $PrefsPath -PathType Leaf)) { throw "AE_CACHE_GUARD_PREFS_MISSING: $PrefsPath" }
  $Document = Read-PreferenceDocument $PrefsPath
  $Settings = Get-DiskCacheSettings $Document.Text
  $RequiredFreeGb = $Settings.MaxSizeGb + $Settings.ReserveGb + $SafetyBufferGb

  $FixedDrives = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop | Where-Object { $_.DeviceID -and $_.FreeSpace } | Sort-Object FreeSpace -Descending)
  $Selected = $FixedDrives | Where-Object { ([double]$_.FreeSpace / 1GB) -ge $RequiredFreeGb } | Select-Object -First 1
  if ($null -eq $Selected) { throw "AE_CACHE_GUARD_NO_SAFE_DRIVE: no fixed drive has at least $RequiredFreeGb GB free." }
  $SelectedDrive = ([string]$Selected.DeviceID).ToUpperInvariant()
  $SelectedFreeGb = [Math]::Round([double]$Selected.FreeSpace / 1GB, 2)
  $OriginalDrive = Get-DriveForPath $Settings.Folder
  $RunToken = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { [Guid]::NewGuid().ToString("N") }
  $TemporaryCacheFolder = Join-Path ($SelectedDrive + "\") (Join-Path $CacheNamespace (Join-Path $Version.PrefsVersion ("m3-marker-motion-p3-p4-" + $RunToken)))
  $Changed = -not ([string]::Equals($Settings.Folder.TrimEnd('\'), $TemporaryCacheFolder.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase))

  $StateParent = Split-Path -Parent $StatePath
  if ($StateParent) { New-Item -ItemType Directory -Force -Path $StateParent | Out-Null }
  $BackupPath = $StatePath + ".prefs-backup"
  if (Test-Path $BackupPath -PathType Leaf) { throw "AE_CACHE_GUARD_BACKUP_EXISTS: $BackupPath" }
  [System.IO.File]::WriteAllBytes($BackupPath, $Document.Bytes)
  $OriginalSha256 = Get-Sha256 $BackupPath

  $State = [ordered]@{
    schemaVersion = 1
    status = "BACKED_UP"
    productVersion = $Version.ProductVersion
    prefsVersion = $Version.PrefsVersion
    prefsPath = $PrefsPath
    backupPath = $BackupPath
    originalPrefsSha256 = $OriginalSha256
    originalCacheFolder = $Settings.Folder
    originalCacheDrive = $OriginalDrive
    temporaryCacheFolder = $TemporaryCacheFolder
    maxSizeGb = $Settings.MaxSizeGb
    reserveGb = $Settings.ReserveGb
    safetyBufferGb = $SafetyBufferGb
    selectedDrive = $SelectedDrive
    selectedDriveFreeGb = $SelectedFreeGb
    changed = $Changed
  }
  Write-JsonFile $StatePath $State

  if ($Changed) {
    New-Item -ItemType Directory -Force -Path $TemporaryCacheFolder | Out-Null
    $UpdatedLines = @($Settings.Lines)
    $UpdatedLines[$Settings.FolderIndex] = '"Folder 7" = "' + $TemporaryCacheFolder + '"'
    $UpdatedText = $UpdatedLines -join $Settings.NewLine
    Write-PreferenceDocument $PrefsPath $UpdatedText $Document.Encoding $Document.HasBom
    $Readback = Read-PreferenceDocument $PrefsPath
    $ReadbackSettings = Get-DiskCacheSettings $Readback.Text
    if (-not [string]::Equals($ReadbackSettings.Folder, $TemporaryCacheFolder, [StringComparison]::OrdinalIgnoreCase)) {
      throw "AE_CACHE_GUARD_READBACK_MISMATCH: temporary disk-cache folder did not read back exactly."
    }
    if ($ReadbackSettings.MaxSizeGb -ne $Settings.MaxSizeGb -or $ReadbackSettings.ReserveGb -ne $Settings.ReserveGb) {
      throw "AE_CACHE_GUARD_SCOPE_VIOLATION: cache size/reserve changed unexpectedly during folder-only patch."
    }
  }

  $State.status = "PREPARED"
  Write-JsonFile $StatePath $State
  Write-JsonFile $EvidencePath (Build-Evidence $State "PREPARED")
  Write-Host ("AE proof cache guard prepared: prefsVersion={0}; original={1}; temporary={2}; maxSizeGb={3}; reserveGb={4}; selectedFreeGb={5}" -f $State.prefsVersion, $State.originalCacheFolder, $State.temporaryCacheFolder, $State.maxSizeGb, $State.reserveGb, $State.selectedDriveFreeGb)
  exit 0
}

if (-not (Test-Path $StatePath -PathType Leaf)) {
  Write-Host "AE proof cache guard restore: no state file exists; nothing to restore."
  exit 0
}

Wait-ForAfterFxExit $RestoreWaitSeconds
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($State.schemaVersion -ne 1 -or -not $State.prefsPath -or -not $State.backupPath -or -not $State.originalPrefsSha256) {
  throw "AE_CACHE_GUARD_STATE_INVALID: restore state is incomplete."
}
if (-not (Test-Path $State.backupPath -PathType Leaf)) { throw "AE_CACHE_GUARD_BACKUP_MISSING: $($State.backupPath)" }
$BackupSha256 = Get-Sha256 $State.backupPath
if ($BackupSha256 -ne ([string]$State.originalPrefsSha256).ToLowerInvariant()) { throw "AE_CACHE_GUARD_BACKUP_HASH_MISMATCH: refusing restore from altered backup." }
$OriginalBytes = [System.IO.File]::ReadAllBytes([string]$State.backupPath)
[System.IO.File]::WriteAllBytes([string]$State.prefsPath, $OriginalBytes)
$RestoredSha256 = Get-Sha256 ([string]$State.prefsPath)
if ($RestoredSha256 -ne ([string]$State.originalPrefsSha256).ToLowerInvariant()) { throw "AE_CACHE_GUARD_RESTORE_HASH_MISMATCH: exact original preferences were not restored." }
Write-JsonFile $EvidencePath (Build-Evidence $State "RESTORED" $RestoredSha256)

$TemporaryCacheFolder = [string]$State.temporaryCacheFolder
if ($State.changed -eq $true -and $TemporaryCacheFolder -and $TemporaryCacheFolder -match '(?i)\\EditFlow2\\AfterEffectsDiskCache\\') {
  try { if (Test-Path $TemporaryCacheFolder -PathType Container) { Remove-Item -LiteralPath $TemporaryCacheFolder -Recurse -Force -ErrorAction Stop } }
  catch { Write-Warning ("Preferences were restored exactly, but proof-owned cache cleanup failed: " + $_.Exception.Message) }
}
Remove-Item -LiteralPath ([string]$State.backupPath) -Force -ErrorAction Stop
Remove-Item -LiteralPath $StatePath -Force -ErrorAction Stop
Write-Host ("AE proof cache guard restored exact preferences SHA-256: " + $RestoredSha256)
