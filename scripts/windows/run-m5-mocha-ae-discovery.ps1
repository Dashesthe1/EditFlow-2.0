param(
  [string]$AfterFxPath = "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe",
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
if (-not $ArtifactDir) { throw "EDITFLOW_PROOF_ARTIFACT_DIR is required." }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ResultPath = Join-Path $ArtifactDir "result.json"
$ProbeScript = Join-Path $ArtifactDir "mocha-ae-discovery.jsx"
$ProbeMarker = Join-Path $ArtifactDir "mocha-ae-discovery.txt"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$BaselineAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
if ($BaselineAePids.Count -ne 1) { throw "Mocha discovery requires exactly one already-running After Effects process; found $($BaselineAePids.Count)." }
Remove-Item $ResultPath,$ProbeScript,$ProbeMarker -Force -ErrorAction SilentlyContinue
$MarkerForJs = $ProbeMarker.Replace('\','/').Replace('"','\"')
$ProbeSource = @"
(function () {
  function esc(v) { return String(v === null || v === undefined ? "" : v).replace(/\r/g, " ").replace(/\n/g, " ").replace(/\t/g, " "); }
  var p = app.project;
  var revBefore = p ? p.revision : null;
  var itemCountBefore = p ? p.numItems : 0;
  var effects = [];
  var all = app.effects || [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    var displayName = String(e.displayName || "");
    var matchName = String(e.matchName || "");
    var category = String(e.category || "");
    if (/mocha/i.test(displayName) || /mocha/i.test(matchName) || /mocha/i.test(category)) effects.push(e);
  }
"@
$ProbeSource += @"
  var exact = null;
  for (var j = 0; j < effects.length; j++) {
    if (/^mocha ae$/i.test(String(effects[j].displayName || ""))) { exact = effects[j]; break; }
  }
  if (!exact && effects.length) exact = effects[0];
  var activeItem = p ? p.activeItem : null;
  var targetLayer = (activeItem && activeItem.layers && activeItem.numLayers > 0) ? activeItem.layer(1) : null;
  var canAdd = "";
  if (targetLayer && exact) {
    var parade = targetLayer.property("ADBE Effect Parade");
    if (parade && typeof parade.canAddProperty === "function") canAdd = String(parade.canAddProperty(exact.matchName || exact.displayName));
  }
  var out = new File("$MarkerForJs");
  if (!out.open("w")) throw new Error("EDITFLOW_M5_MOCHA_DISCOVERY_OPEN_FAILED");
  out.writeln("HOST_VERSION\t" + esc(app.version));
  out.writeln("PROJECT_PATH\t" + esc((p && p.file) ? p.file.fsName : ""));
  out.writeln("REVISION_BEFORE\t" + esc(revBefore));
  out.writeln("REVISION_AFTER\t" + esc(p ? p.revision : null));
  out.writeln("ITEMS_BEFORE\t" + esc(itemCountBefore));
  out.writeln("ITEMS_AFTER\t" + esc(p ? p.numItems : 0));
  out.writeln("ACTIVE_ITEM\t" + esc(activeItem ? activeItem.name : ""));
  out.writeln("TARGET_LAYER\t" + esc(targetLayer ? targetLayer.name : ""));
  out.writeln("CAN_ADD\t" + esc(canAdd));
  out.writeln("EXACT\t" + esc(exact ? exact.displayName : "") + "\t" + esc(exact ? exact.matchName : "") + "\t" + esc(exact ? exact.category : "") + "\t" + esc(exact ? exact.version : ""));
  for (var k = 0; k < effects.length; k++) out.writeln("EFFECT\t" + esc(effects[k].displayName) + "\t" + esc(effects[k].matchName) + "\t" + esc(effects[k].category) + "\t" + esc(effects[k].version));
  out.close();
}());
"@
[System.IO.File]::WriteAllText($ProbeScript, $ProbeSource, $Utf8NoBom)
$Timer = [System.Diagnostics.Stopwatch]::StartNew()
[void](Start-Process -FilePath $AfterFxPath -ArgumentList @('-r', $ProbeScript) -PassThru)
$Deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds - 2))
while (-not (Test-Path $ProbeMarker -PathType Leaf) -and (Get-Date) -lt $Deadline) { Start-Sleep -Milliseconds 50 }
$Timer.Stop()
if (-not (Test-Path $ProbeMarker -PathType Leaf)) { throw "Mocha discovery marker was not produced before timeout." }
$Lines = @(Get-Content $ProbeMarker -ErrorAction Stop)
function Field([string]$Name) {
  $line = $Lines | Where-Object { $_ -like ($Name + "`t*") } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "`t", 2)[1]
}
$ExactLine = $Lines | Where-Object { $_ -like "EXACT`t*" } | Select-Object -First 1
$ExactParts = if ($ExactLine) { $ExactLine -split "`t", 5 } else { @() }
$Exact = if ($ExactParts.Count -ge 3 -and $ExactParts[1] -and $ExactParts[2]) {
  [ordered]@{ displayName = $ExactParts[1]; matchName = $ExactParts[2] }
} else { $null }
$Effects = @($Lines | Where-Object { $_ -like "EFFECT`t*" } | ForEach-Object {
  $p = $_ -split "`t", 5
  [ordered]@{ displayName = $p[1]; matchName = $p[2]; category = if ($p.Count -gt 3) { $p[3] } else { "" }; version = if ($p.Count -gt 4) { $p[4] } else { "" } }
})
$AfterAePids = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } | Sort-Object)
$SameAeProcess = (($BaselineAePids -join ',') -eq ($AfterAePids -join ',')) -and $BaselineAePids.Count -eq 1
$ProjectUnchanged = (Field "REVISION_BEFORE") -eq (Field "REVISION_AFTER") -and (Field "ITEMS_BEFORE") -eq (Field "ITEMS_AFTER")
$RoundtripMs = [Math]::Round($Timer.Elapsed.TotalMilliseconds, 3)
$CanAddText = Field "CAN_ADD"
$CanAdd = if ($CanAddText -eq "true") { $true } elseif ($CanAddText -eq "false") { $false } else { $null }
$Ok = ($null -ne $Exact) -and $SameAeProcess -and $ProjectUnchanged
$Result = [ordered]@{
  proofId = "M5_MOCHA_AE_DISCOVERY_REAL_AE_V1"
  classification = if ($Ok) { "PASS" } else { "PRODUCT_FAILURE" }
  ok = $Ok
  mutationStarted = $false
  cleanupComplete = $true
  baselineAePids = $BaselineAePids
  afterAePids = $AfterAePids
  sameAeProcess = $SameAeProcess
  projectUnchanged = $ProjectUnchanged
  roundtripMs = $RoundtripMs
  hostVersion = Field "HOST_VERSION"
  projectPath = Field "PROJECT_PATH"
  activeItemName = Field "ACTIVE_ITEM"
  targetLayerName = Field "TARGET_LAYER"
  activeLayerCanAddMochaAe = $CanAdd
  exactMochaAe = $Exact
  mochaEffects = $Effects
  message = if ($Ok) { "Mocha AE was discovered through AE registered effect metadata without mutating the project or replacing the warm AE process." } else { "Mocha AE discovery did not satisfy plugin identity, same-process, and read-only project gates." }
}
[System.IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 12) + [Environment]::NewLine), $Utf8NoBom)
if (-not $Ok) { Write-Error $Result.message; exit 1 }
Write-Host $Result.message
Write-Host ("Result: " + $ResultPath)
Write-Host ("Discovery roundtrip: " + $RoundtripMs + " ms")
Write-Host ("Mocha match: " + $Exact.displayName + " / " + $Exact.matchName)
