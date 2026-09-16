import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";
import { registerAcceptedM5RotoBrushRuntimeCapabilities } from "../.tmp/runtime/apps/desktop-host/src/ae-runtime-capabilities.js";
import { loadTrustedM5RotoBrushRuntimeEvidenceV1 } from "../.tmp/runtime/apps/desktop-host/src/m5-roto-brush-runtime-evidence.js";

const fakeObservedState = (projectId) => ({
  observed: {
    projectId,
    projectRevision: "m5-runtime-revision",
    projectFingerprint: "m5-runtime-project-fingerprint",
    environmentFingerprint: "m5-runtime-environment",
  },
  project: { schemaVersion: 1, projectId, filePath: null, itemCount: 0, items: [] },
  hostRevision: 1,
});
const adapter = { observe: async (projectId) => fakeObservedState(projectId) };

const proofIds = Object.freeze({
  foregroundSeed: "M5_ROTO_BRUSH_FOREGROUND_SEED_RETAINED_REAL_AE_V1",
  backgroundSeed: "M5_ROTO_BRUSH_BACKGROUND_SEED_RETAINED_REAL_AE_V1",
  propagationForward: "M5_ROTO_BRUSH_PROPAGATION_FORWARD_RETAINED_REAL_AE_V1",
  propagationBackward: "M5_ROTO_BRUSH_PROPAGATION_BACKWARD_RETAINED_REAL_AE_V1",
  refineEdge: "M5_ROTO_BRUSH_REFINE_EDGE_RETAINED_REAL_AE_V1",
  freezeState: "M5_ROTO_BRUSH_FREEZE_STATE_DISCOVERY_RETAINED_REAL_AE_V1",
  repairStroke: "M5_ROTO_BRUSH_REPAIR_STROKE_RETAINED_REAL_AE_V1",
  trackMatteExport: "M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_RETAINED_REAL_AE_V1",
  materialTransfer: "M5_ROTO_BRUSH_MATERIAL_TRANSFER_RETAINED_REAL_AE_V1",
  popupFault: "M5_ROTO_BRUSH_POPUP_FAULT_HANDLING_RETAINED_REAL_AE_V1",
});

const validEvidence = (overrides = {}) => ({
  schema: "editflow.m5.roto-brush-runtime-evidence.v1",
  evidenceId: "M5:ROTO:LIVE:PRODUCTION:001",
  proofs: Object.fromEntries(Object.entries(proofIds).map(([key, proofId], index) => [key, {
    proofId,
    resultSha256: String(index + 1).repeat(64).slice(0, 64),
  }])),
  sourceFixtureCount: 2,
  sameProcessAccepted: true,
  exactRestoreAccepted: true,
  materiallyDifferentTransferAccepted: true,
  popupFaultRecoveryAccepted: true,
  trackMatteExportAccepted: true,
  maskExportAccepted: false,
  maxMeasuredWarmAeActionGapMs: 259.241,
  popupRecoveryRoundtripMs: 1836.959,
  ...overrides,
});

const withEvidenceFile = async (evidence, fn, digestOverride = null) => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-m5-roto-evidence-"));
  const evidencePath = join(dir, "accepted.json");
  const bytes = Buffer.from(JSON.stringify(evidence), "utf8");
  const digest = digestOverride ?? createHash("sha256").update(bytes).digest("hex");
  await writeFile(evidencePath, bytes);
  await writeFile(`${evidencePath}.sha256`, `${digest}\n`, "utf8");
  try { return await fn({ evidencePath }, createHash("sha256").update(bytes).digest("hex")); }
  finally { await rm(dir, { recursive: true, force: true }); }
};

test("default desktop session keeps all M5 Roto Brush production routes fail-closed", async () => {
  const session = await createDesktopAeSession(adapter, "m5-default");
  assert.equal(session.m5RotoBrushRuntimeRegistered, false);
  assert.equal(session.m5RotoBrushRuntimeEvidenceFileSha256, null);
  for (const id of [
    "ae.roto_brush.session.inspect", "ae.roto_brush.seed.apply", "ae.roto_brush.propagate",
    "ae.roto_brush.refine_edge.apply", "ae.roto_brush.freeze.set", "ae.roto_brush.repair.apply", "ae.roto_brush.export_matte",
  ]) assert.equal(session.registry.get(id), null);
});

test("M5 runtime evidence rejects malformed, incomplete, or widened acceptance claims", async () => {
  const missingProof = validEvidence(); delete missingProof.proofs.freezeState;
  const wrongProofId = validEvidence(); wrongProofId.proofs = { ...wrongProofId.proofs, repairStroke: { ...wrongProofId.proofs.repairStroke, proofId: "M5_FAKE" } };
  const upperDigest = validEvidence(); upperDigest.proofs = { ...upperDigest.proofs, foregroundSeed: { ...upperDigest.proofs.foregroundSeed, resultSha256: "A".repeat(64) } };
  const cases = [
    true,
    validEvidence({ schema: "wrong.schema" }),
    validEvidence({ evidenceId: "bad spaced id" }),
    missingProof,
    wrongProofId,
    upperDigest,
    validEvidence({ sourceFixtureCount: 1 }),
    validEvidence({ sameProcessAccepted: false }),
    validEvidence({ exactRestoreAccepted: false }),
    validEvidence({ materiallyDifferentTransferAccepted: false }),
    validEvidence({ popupFaultRecoveryAccepted: false }),
    validEvidence({ trackMatteExportAccepted: false }),
    validEvidence({ maskExportAccepted: true }),
    validEvidence({ maxMeasuredWarmAeActionGapMs: 3000.001 }),
    validEvidence({ popupRecoveryRoundtripMs: 3000.001 }),
    validEvidence({ unexpectedField: true }),
  ];
  for (const [index, evidence] of cases.entries()) {
    await withEvidenceFile(evidence, async (file) => {
      const session = await createDesktopAeSession(adapter, `m5-refuse-${index}`, { m5RotoBrushRuntimeEvidenceFile: file });
      assert.equal(session.m5RotoBrushRuntimeRegistered, false);
      assert.equal(session.m5RotoBrushRuntimeEvidenceFileSha256, null);
      assert.equal(session.registry.get("ae.roto_brush.seed.apply"), null);
    });
  }
});

test("M5 caller-created evidence objects cannot bypass the retained-file trust boundary", async () => {
  const forged = { evidence: validEvidence(), evidencePath: "forged.json", evidenceFileSha256: "a".repeat(64) };
  const session = await createDesktopAeSession(adapter, "m5-forged");
  assert.equal(registerAcceptedM5RotoBrushRuntimeCapabilities(session.registry, forged), false);
  assert.equal(session.registry.get("ae.roto_brush.seed.apply"), null);
});

test("M5 retained runtime evidence refuses a mismatched SHA-256 sidecar", async () => {
  await withEvidenceFile(validEvidence(), async (file) => {
    assert.equal(await loadTrustedM5RotoBrushRuntimeEvidenceV1(file), null);
  }, "0".repeat(64));
});

test("trusted M5 evidence registers only the retained capability envelope", async () => {
  await withEvidenceFile(validEvidence(), async (file, fileSha256) => {
    const session = await createDesktopAeSession(adapter, "m5-accept", { m5RotoBrushRuntimeEvidenceFile: file });
    assert.equal(session.m5RotoBrushRuntimeRegistered, true);
    assert.equal(session.m5RotoBrushRuntimeEvidenceFileSha256, fileSha256);
    const expected = new Map([
      ["ae.roto_brush.session.inspect", ["FULL", "TRANSFER"]],
      ["ae.roto_brush.seed.apply", ["FULL", "TRANSFER"]],
      ["ae.roto_brush.propagate", ["PARTIAL", "VISUAL"]],
      ["ae.roto_brush.refine_edge.apply", ["PARTIAL", "VISUAL"]],
      ["ae.roto_brush.freeze.set", ["PARTIAL", "VISUAL"]],
      ["ae.roto_brush.repair.apply", ["PARTIAL", "VISUAL"]],
      ["ae.roto_brush.export_matte", ["PARTIAL", "TRANSFER"]],
    ]);
    for (const [id, [status, maturity]] of expected) {
      const capability = session.registry.get(id);
      assert.ok(capability, id);
      assert.equal(capability.status, status);
      assert.equal(capability.proofMaturity, maturity);
      assert.ok(capability.routes.some((route) => route.available && route.adapterVersion === "0.6.0-dev.3"));
      assert.ok(capability.limitations.some((value) => value.includes("M5:ROTO:LIVE:PRODUCTION:001")));
    }
    const exported = session.registry.get("ae.roto_brush.export_matte");
    assert.ok(exported.limitations.some((value) => value.includes("MASK conversion remains unproven and unavailable")));
  });
});

test("the retained workstation evidence file is digest-valid and production-registerable", async () => {
  const evidencePath = "proofs/diagnostics/m5-roto-brush-runtime-evidence-live.json";
  const bytes = await readFile(evidencePath);
  const expectedDigest = (await readFile(`${evidencePath}.sha256`, "utf8")).trim();
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedDigest);
  assert.equal(expectedDigest, "ddf373ea782648fbc223482e22e5a36fe8cd66e145fc1e41e18607ca0b8e822c");
  const session = await createDesktopAeSession(adapter, "m5-retained-live", { m5RotoBrushRuntimeEvidenceFile: { evidencePath } });
  assert.equal(session.m5RotoBrushRuntimeRegistered, true);
  assert.equal(session.m5RotoBrushRuntimeEvidenceFileSha256, expectedDigest);
  assert.equal(session.registry.get("ae.roto_brush.seed.apply")?.proofMaturity, "TRANSFER");
  assert.equal(session.registry.get("ae.roto_brush.export_matte")?.proofMaturity, "TRANSFER");
});
