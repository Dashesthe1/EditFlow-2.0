import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildFailureCapsule,
  contentKeyForProofNode,
  createProofToken,
  decideIncrementalProof,
  validateVisualStateLease,
} from "../.tmp/runtime/packages/incremental-proof-engine/src/index.js";

const dependency = { id: "packages/demo.ts", sha256: "a".repeat(64) };
const node = (overrides = {}) => ({
  proofId: "M5_DEMO",
  nodeId: "M5_DEMO:delta",
  strategy: "INCREMENTAL_FIRST",
  environmentFingerprint: "afterfx=25.6.6|node=v22",
  checkpointKey: "roto-seeded-v1",
  dependencies: [dependency],
  ...overrides,
});

test("matching content-addressed PASS evidence is reused", () => {
  const current = node();
  const token = createProofToken(current, "b".repeat(64), "2026-09-15T00:00:00Z");
  const decision = decideIncrementalProof(current, token);
  assert.equal(decision.action, "REUSE_PASS");
  assert.equal(decision.contentKey, contentKeyForProofNode(current));
  assert.equal(decision.reusableToken, token);
});

test("dependency changes invalidate only the affected proof node", () => {
  const original = node();
  const token = createProofToken(original, "c".repeat(64));
  const changed = node({ dependencies: [{ ...dependency, sha256: "d".repeat(64) }] });
  const decision = decideIncrementalProof(changed, token);
  assert.equal(decision.action, "RUN_DELTA");
  assert.match(decision.reason, /dependencies no longer match/i);
});

test("full acceptance always bypasses reusable evidence", () => {
  const acceptance = node({ strategy: "FULL_ACCEPTANCE" });
  const token = createProofToken(node(), "e".repeat(64));
  const decision = decideIncrementalProof(acceptance, token);
  assert.equal(decision.action, "RUN_FULL");
  assert.equal(decision.reusableToken, null);
});

test("visual state lease stays cheap until an invariant changes", () => {
  const lease = {
    schema: "editflow.visual-state-lease.v1",
    leaseId: "lease-1",
    aePid: 42,
    projectRevision: 11,
    targetBindingHash: "target",
    windowGeometryHash: "window",
    roiHashes: { canvas: "canvas", toolbar: "toolbar" },
    issuedAtMs: 100,
    expiresAtMs: 10_000,
  };
  const observation = {
    aePid: 42, projectRevision: 11, targetBindingHash: "target",
    windowGeometryHash: "window", roiHashes: { canvas: "canvas", toolbar: "toolbar" }, nowMs: 500,
  };
  assert.deepEqual(validateVisualStateLease(lease, observation), { valid: true, reason: "LEASE_VALID" });
  assert.deepEqual(validateVisualStateLease(lease, { ...observation, roiHashes: { ...observation.roiHashes, toolbar: "changed" } }), { valid: false, reason: "ROI_CHANGED:toolbar" });
});

test("failure capsule carries one bounded reasoning payload", () => {
  const capsule = buildFailureCapsule({
    proofId: "M5_DEMO", nodeId: "refine-edge", failureClass: "TOOL_SELECTION_UNVERIFIED",
    detail: "toolbar invariant changed", lastAcceptedNodeId: "seed", codeDiffDigest: "abc",
    targetBindingHash: "target", projectRevision: 12, evidenceIds: ["screen-1"],
    diagnosticResults: { toolbarChanged: true },
  });
  assert.equal(capsule.schema, "editflow.failure-capsule.v1");
  assert.equal(capsule.failureClass, "TOOL_SELECTION_UNVERIFIED");
});

const runGate = (repo, cache, request, action, result = null) => {
  const gate = fileURLToPath(new URL("../scripts/incremental-proof-gate.mjs", import.meta.url));
  const argv = [gate, "--action", action, "--request", request, "--repo", repo,
    "--cache-dir", cache, "--environment", "afterfx=25.6.6|node=v22"];
  if (result) argv.push("--result", result);
  const run = spawnSync(process.execPath, argv, { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout.trim());
};

test("standalone gate records, reuses, invalidates, and bypasses on acceptance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-proof-gate-"));
  await mkdir(path.join(root, "scripts", "windows"), { recursive: true });
  await mkdir(path.join(root, "packages", "demo"), { recursive: true });
  const proof = path.join(root, "scripts", "windows", "run-demo.ps1");
  const dep = path.join(root, "packages", "demo", "source.ts");
  const request = path.join(root, "request.json");
  const result = path.join(root, "result.json");
  const cache = path.join(root, "cache");
  await writeFile(proof, "Write-Output demo\n");
  await writeFile(dep, "export const value = 1;\n");
  await writeFile(result, JSON.stringify({ classification: "PASS", ok: true }));
  const baseRequest = {
    proofId: "M5_GATE_DEMO", proofScript: "scripts/windows/run-demo.ps1", lifecycle: "REUSE_AE",
    artifactDir: "proofs/artifacts/demo", timeoutSeconds: 30, proofStrategy: "INCREMENTAL_FIRST",
    incrementalDependencies: ["packages/demo"], incrementalNodeId: "M5_GATE_DEMO:delta",
    checkpointKey: "seeded", allowEvidenceReuse: true,
  };
  await writeFile(request, JSON.stringify(baseRequest));
  assert.equal(runGate(root, cache, request, "plan").action, "RUN_DELTA");
  assert.equal(runGate(root, cache, request, "record", result).action, "RECORDED_PASS");
  assert.equal(runGate(root, cache, request, "plan").action, "REUSE_PASS");

  await writeFile(dep, "export const value = 2;\n");
  assert.equal(runGate(root, cache, request, "plan").action, "RUN_DELTA");

  await writeFile(request, JSON.stringify({ ...baseRequest, proofStrategy: "FULL_ACCEPTANCE" }));
  assert.equal(runGate(root, cache, request, "plan").action, "RUN_FULL");
});

test("AE harness makes incremental-first the canonical milestone entry path", async () => {
  const schema = JSON.parse(await readFile(new URL("../spec/ae-development-proof-request.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.proofStrategy.default, "INCREMENTAL_FIRST");
  assert.deepEqual(schema.properties.proofStrategy.enum, ["INCREMENTAL_FIRST", "FULL_ACCEPTANCE"]);
  assert.equal(schema.properties.allowEvidenceReuse.default, true);
  const harness = await readFile(new URL("../scripts/windows/invoke-editflow-ae-proof.ps1", import.meta.url), "utf8");
  assert.match(harness, /incremental-proof-gate\.mjs/);
  assert.match(harness, /REUSE_PASS/);
  assert.match(harness, /FULL_ACCEPTANCE/);
  assert.match(harness, /Incremental proof engine reused an accepted PASS token/);
  assert.ok(harness.indexOf("REUSE_PASS") < harness.indexOf("$SupervisorWatch"), "cache decision must occur before supervisor/AE proof startup");
});
