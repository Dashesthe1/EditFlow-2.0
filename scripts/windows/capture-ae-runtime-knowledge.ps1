param(
  [string]$AfterFxPath = "",
  [string]$OutputPath = "",
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProfilerPath = Join-Path $RepoRoot "packages\adapters\ae-cep\host\editflow_host_runtime_knowledge.jsx"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
$KnowledgeRoot = if ($ArtifactDir) { $ArtifactDir } else { Join-Path $env:LOCALAPPDATA "EditFlow2\knowledge" }
if (-not $OutputPath) { $OutputPath = Join-Path $KnowledgeRoot "ae-runtime-knowledge.json" }
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$OutputDir = Split-Path -Parent $OutputPath
$BootstrapPath = Join-Path $OutputDir "capture-ae-runtime-knowledge-bootstrap.jsx"
$SentinelPath = Join-Path $OutputDir "capture-ae-runtime-knowledge-sentinel.txt"
$ResultPath = if ($ArtifactDir) { Join-Path $ArtifactDir "result.json" } else { $null }
$StartedAt = (Get-Date).ToUniversalTime().ToString("o")
$TargetPid = $null
$FailureMessage = $null
$Knowledge = $null

if ($TimeoutSeconds -lt 10) { throw "TimeoutSeconds must be at least 10." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
if (Test-Path $OutputPath -PathType Leaf) { Remove-Item $OutputPath -Force }
if (Test-Path $SentinelPath -PathType Leaf) { Remove-Item $SentinelPath -Force }

function Resolve-RunningAfterFx {
  param([string]$ExplicitPath)
  $Running = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  if ($Running.Count -eq 0) { throw "Adobe After Effects is not running. Runtime knowledge capture reuses an existing AE process and will not start one implicitly." }

  $ResolvedExplicit = $null
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath -PathType Leaf)) { throw "AfterFX.exe not found: $ExplicitPath" }
    $ResolvedExplicit = (Resolve-Path $ExplicitPath).Path
  }

  $Matches = @()
  foreach ($Process in $Running) {
    try {
      $CandidatePath = (Resolve-Path $Process.Path).Path
      $Process.Refresh()
      if (
        (-not $ResolvedExplicit -or [StringComparer]::OrdinalIgnoreCase.Equals($CandidatePath, $ResolvedExplicit)) -and
        $Process.Responding
      ) {
        $Matches += $Process
      }
    } catch {}
  }
  if ($Matches.Count -ne 1) { throw "Runtime knowledge capture requires exactly one unambiguous healthy After Effects process; found $($Matches.Count)." }
  return [pscustomobject]@{ Process = $Matches[0]; Path = (Resolve-Path $Matches[0].Path).Path }
}

function Write-BootstrapScript {
  param([string]$ScriptPath, [string]$ModulePath, [string]$KnowledgePath, [string]$Sentinel)
  $ModuleLiteral = (($ModulePath -replace '\\','/') | ConvertTo-Json -Compress)
  $KnowledgeLiteral = (($KnowledgePath -replace '\\','/') | ConvertTo-Json -Compress)
  $SentinelLiteral = (($Sentinel -replace '\\','/') | ConvertTo-Json -Compress)
  $Text = @"
(function () {
  function writeSentinel(value) {
    try {
      var sentinel = new File($SentinelLiteral);
      sentinel.encoding = "UTF-8";
      if (sentinel.open("w")) { sentinel.write(value); sentinel.close(); return true; }
    } catch (_) {}
    return false;
  }
  try {
    var moduleFile = new File($ModuleLiteral);
    if (!moduleFile.exists) throw new Error("runtime knowledge profiler module is missing: " + moduleFile.fsName);
    $.evalFile(moduleFile);
    if (typeof $.global.EditFlow2_writeAeRuntimeKnowledge !== "function") throw new Error("runtime knowledge profiler did not register");
    $.global.EditFlow2_writeAeRuntimeKnowledge($KnowledgeLiteral);
    writeSentinel("OK");
  } catch (error) {
    writeSentinel("ERROR:" + String(error));
  }
}());
"@
  [System.IO.File]::WriteAllText($ScriptPath, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-ExistingAeScript {
  param([string]$AfterFx, [string]$ScriptPath)
  $Arguments = @("-r", ('"' + $ScriptPath + '"'))
  $Launcher = Start-Process -FilePath $AfterFx -ArgumentList $Arguments -PassThru
  try { Wait-Process -Id $Launcher.Id -Timeout 20 -ErrorAction SilentlyContinue } catch {}
}

function Wait-ForCapture {
  param([int]$Seconds)
  $Deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (Test-Path $SentinelPath -PathType Leaf) {
      $Value = [System.IO.File]::ReadAllText($SentinelPath)
      if ($Value -eq "OK") {
        if (-not (Test-Path $OutputPath -PathType Leaf)) { throw "AE reported runtime knowledge capture success but no output file exists." }
        return
      }
      if ($Value.StartsWith("ERROR:")) { throw ("After Effects runtime knowledge capture failed: " + $Value.Substring(6)) }
    }
    Start-Sleep -Milliseconds 150
  } while ((Get-Date) -lt $Deadline)
  throw "After Effects did not produce the runtime-knowledge sentinel before timeout. Ensure Preferences > Scripting & Expressions > 'Allow Scripts to Write Files and Access Network' is enabled; capture does not restart AE automatically."
}

function Count-PropertyNodes {
  param($Nodes)
  $Count = 0
  foreach ($Node in @($Nodes)) {
    $Count += 1
    if ($null -ne $Node.children) { $Count += Count-PropertyNodes -Nodes $Node.children }
  }
  return $Count
}

function Write-ProofResult {
  param([string]$Classification, [string]$Message, [bool]$StablePid)
  if (-not $ResultPath) { return }
  $InstalledEffectCount = if ($Knowledge) { @($Knowledge.installedEffects).Count } else { 0 }
  $PropertyNodeCount = 0
  if ($Knowledge -and $Knowledge.activeComposition) {
    foreach ($Layer in @($Knowledge.activeComposition.layers)) { $PropertyNodeCount += Count-PropertyNodes -Nodes $Layer.properties }
  }
  $Result = [ordered]@{
    proofId = if ($env:EDITFLOW_PROOF_ID) { $env:EDITFLOW_PROOF_ID } else { "infra.ae_runtime_knowledge.capture" }
    classification = $Classification
    ok = ($Classification -eq "PASS")
    message = $Message
    lifecycle = $env:EDITFLOW_AE_LIFECYCLE
    mutationStarted = $false
    cleanupComplete = $true
    knowledgeOutput = $OutputPath
    schemaVersion = if ($Knowledge) { [string]$Knowledge.schemaVersion } else { $null }
    profilerVersion = if ($Knowledge) { [string]$Knowledge.profilerVersion } else { $null }
    hostVersion = if ($Knowledge) { [string]$Knowledge.host.version } else { $null }
    installedEffectCount = $InstalledEffectCount
    propertyNodeCount = $PropertyNodeCount
    warnings = if ($Knowledge) { @($Knowledge.warnings) } else { @() }
    warmProcess = [ordered]@{
      pidBefore = $TargetPid
      pidAfter = if ($TargetPid -and (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { $TargetPid } else { $null }
      reused = $true
      restarted = $false
      stablePid = $StablePid
    }
    startedAt = $StartedAt
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  [System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 20) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if (-not (Test-Path $ProfilerPath -PathType Leaf)) { throw "AE runtime knowledge profiler is missing: $ProfilerPath" }
  $Running = Resolve-RunningAfterFx -ExplicitPath $AfterFxPath
  $AfterFx = $Running.Path
  $TargetPid = [int]$Running.Process.Id

  Write-BootstrapScript -ScriptPath $BootstrapPath -ModulePath $ProfilerPath -KnowledgePath $OutputPath -Sentinel $SentinelPath
  Invoke-ExistingAeScript -AfterFx $AfterFx -ScriptPath $BootstrapPath
  Wait-ForCapture -Seconds $TimeoutSeconds

  $SameProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if (-not $SameProcess) { throw "The original After Effects process disappeared during read-only runtime knowledge capture." }

  $Knowledge = Get-Content $OutputPath -Raw | ConvertFrom-Json
  if ([string]$Knowledge.schemaVersion -ne "1.0.0") { throw "Unexpected runtime knowledge schema version: $($Knowledge.schemaVersion)" }
  if ([string]$Knowledge.source -ne "RUNTIME_EXTENDSCRIPT") { throw "Runtime knowledge source marker is missing or invalid." }
  if (-not $Knowledge.host -or -not [string]$Knowledge.host.version) { throw "Runtime knowledge capture did not report an After Effects version." }
  if ($null -eq $Knowledge.installedEffects) { throw "Runtime knowledge capture did not report the installed effect catalog." }

  $PropertyNodeCount = 0
  if ($Knowledge.activeComposition) {
    foreach ($Layer in @($Knowledge.activeComposition.layers)) { $PropertyNodeCount += Count-PropertyNodes -Nodes $Layer.properties }
  }
  Write-ProofResult -Classification "PASS" -Message "Captured installed After Effects runtime knowledge without mutating or restarting the warm AE process." -StablePid $true
  Write-Host "EditFlow AE runtime knowledge capture passed."
  Write-Host ("AE version: " + [string]$Knowledge.host.version)
  Write-Host ("Installed effects: " + @($Knowledge.installedEffects).Count)
  Write-Host ("Observed property nodes: " + $PropertyNodeCount)
  Write-Host ("Knowledge artifact: " + $OutputPath)
  exit 0
} catch {
  $FailureMessage = $_.Exception.Message
  $StablePid = $false
  if ($TargetPid) { $StablePid = $null -ne (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) }
  Write-ProofResult -Classification "INFRASTRUCTURE_FAILURE" -Message $FailureMessage -StablePid $StablePid
  Write-Error $FailureMessage
  exit 1
}
