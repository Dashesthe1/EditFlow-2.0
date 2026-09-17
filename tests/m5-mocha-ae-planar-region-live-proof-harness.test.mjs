import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-planar-region-development.request.json";
const runnerPath = "scripts/windows/run-m5-mocha-ae-planar-region-live-proof.ps1";
const createPath = "scripts/windows/m5-mocha-ae-guarded-create-planar-region.ps1";
const promptPath = "scripts/windows/m5-mocha-ae-startup-prompts.ps1";
const closePath = "scripts/windows/m5-mocha-ae-close-proof-session.ps1";

test("M5 Mocha planar-region proof is retained, warm-AE, and non-retrying", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.equal(manifest.incrementalNodeId, "M5_MOCHA_AE_CREATE_PLANAR_REGION");
  assert.ok(manifest.incrementalDependencies.includes(createPath));
  assert.ok(manifest.incrementalDependencies.includes(promptPath));
  assert.ok(manifest.incrementalDependencies.includes(closePath));
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /PlanarRegionVerified/);
  assert.match(runner, /layer1UiaVerified/);
  assert.match(runner, /sameAeProcess/i);
  assert.match(runner, /maxMeasuredWarmAeRoundtripMs/);
  assert.match(runner, /ProofScriptEndpoint/);
  assert.match(runner, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(runner, /Invoke-WebRequest/);
  assert.match(runner, /WARM_CEP_PROOF_SCRIPT/);
  assert.doesNotMatch(runner, /Start-Process -FilePath \$AfterFxPath/);
});

test("planar-region creation binds exact Mocha tool identity and bounded geometry", async () => {
  const create = await readFile(createPath, "utf8");
  assert.match(create, /Create X-spline Layer/);
  assert.match(create, /GUI::DropdownToolButton/);
  assert.match(create, /WindowFromPoint/);
  assert.match(create, /receiverPid/);  assert.match(create, /\$norm=@\(@\(0\.57,0\.35\)/);
  assert.match(create, /@\(0\.69,0\.49\)/);
  assert.match(create, /layer1UiaCount/);
  assert.match(create, /AutomationElement/);
  assert.match(create, /PropertyCondition/);
  assert.match(create, /FindAll/);
  assert.match(create, /BoundingRectangle/);
  assert.match(create, /toolCandidates\.Count -ne 1/);
  assert.match(create, /SEMANTIC_UIA_BOUNDS/);
  assert.doesNotMatch(create, /0\.159\*\$w/);
  assert.doesNotMatch(create, /0\.073\*\$h/);
  assert.match(create, /PHYSICAL_EXACT_UIA_TARGET/);
  assert.match(create, /SetCursorPos\(\$toolX,\$toolY\)/);
  assert.match(create, /X-Spline tool mouse-down/);
});

test("Mocha startup handling is exact-title, fixed-action, and fail-closed", async () => {
  const prompts = await readFile(promptPath, "utf8");
  assert.match(prompts, /Welcome to Mocha AE/);
  assert.match(prompts, /Thank you from Boris FX/);
  assert.match(prompts, /Mocha AE Plugin 2025/);
  assert.match(prompts, /Unexpected visible Mocha window after startup-prompt handling/);
  assert.match(prompts, /PostMessage/);
  assert.doesNotMatch(prompts, /Parameter\(Mandatory=\$true\).*ButtonName/);
  assert.doesNotMatch(prompts, /Parameter\(Mandatory=\$true\).*WindowTitle/);
});

test("proof-owned Mocha close handles only the exact unsaved-changes prompt", async () => {
  const close = await readFile(closePath, "utf8");
  assert.match(close, /Mocha AE \*/);
  assert.match(close, /Do you want to save the changes you made in the project\?/);
  assert.match(close, /Don\'t Save/);
  assert.match(close, /InvokePattern/);
  assert.match(close, /INVOKE_DONT_SAVE_EXACT/);
});
