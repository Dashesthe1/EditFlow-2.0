import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256, M3_MOTION_RENDER_P1_P2_RESULT_SHA256,
  M3_MOTION_RENDER_P3_P4_ACCEPTED_SOURCE_COMMIT, M3_MOTION_RENDER_P3_P4_ACCEPTANCE_CONTROL_COMMIT, M3_MOTION_RENDER_P3_P4_ACCEPTANCE_RUN, M3_MOTION_RENDER_P3_P4_ACCEPTANCE_JOB, M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT, M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT_SHA256, M3_MOTION_RENDER_P3_P4_RESULT_SHA256,
  M3_MOTION_RENDER_P5_ACCEPTED_SOURCE_COMMIT, M3_MOTION_RENDER_P5_ACCEPTANCE_CONTROL_COMMIT, M3_MOTION_RENDER_P5_ACCEPTANCE_RUN, M3_MOTION_RENDER_P5_ACCEPTANCE_JOB, M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT, M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT_SHA256, M3_MOTION_RENDER_P5_RESULT_SHA256, M3_MOTION_RENDER_P5_PROJECT_SHA256,
  applyM3MotionRenderAcceptedP1P2Evidence, applyM3MotionRenderAcceptedP3P4Evidence, applyM3MotionRenderAcceptedP5Evidence,
  m3MotionRenderP1P2MaturityForCapability, m3MotionRenderP3P4MaturityForCapability, m3MotionRenderP5MaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-motion-render-proof-maturity.js";
import { M3_MOTION_RENDER_CAPABILITIES_V110 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-motion-render.js";

const p1P2AcceptancePath = "proofs/diagnostics/m3-motion-render-p1-p2-acceptance.json";
const p3P4AcceptancePath = "proofs/diagnostics/m3-motion-render-p3-p4-run4-acceptance.md";
const p5AcceptancePath = "proofs/diagnostics/m3-motion-render-p5-run1-acceptance.md";
const expectedCapabilities = ["ae.comp.motion_render.set", "ae.layer.motion_render.set", "ae.motion_render.readback"];

test("motion-render staged maturity remains pinned to retained real-AE provenance", () => {
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT, "70b1549c56179689fb033db36f13fc4b6dbb5998");
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT, "34adbd69d6cfb847c2900551cd5ee6caa872981a");
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN, 34275036819);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB, 102225850170);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT, 10075375705);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256, "16ae4571d870aefba43e432016b93e8db6efc2060c49eea841315247d3ed9014");
  assert.equal(M3_MOTION_RENDER_P1_P2_RESULT_SHA256, "d29b4ecb1898aacd4b706421e338254e50d525a86449b9c62b47b939e3004927");
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTED_SOURCE_COMMIT, "042a54b63a73dc3fcbcd77d5cb9d6f981492713e");
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTANCE_CONTROL_COMMIT, "b25003477abdf7001779bbdd33247e13bd30b1e9");
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTANCE_RUN, 34279808693);
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTANCE_JOB, 102241577916);
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT, 10077191111);
  assert.equal(M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT_SHA256, "79651dec656bd360e14d2db351333e05cbfee4d1e2efdc0c96dc79c56d509dcf");
  assert.equal(M3_MOTION_RENDER_P3_P4_RESULT_SHA256, "ca8db8ed5443dbde8f0db812584a593b34aebcde7e5aeb7bb85aff95477aae70");
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTED_SOURCE_COMMIT, "79dabd7573d99fc8b0664032d54658d65bc1cf02");
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTANCE_CONTROL_COMMIT, "364055888dcb404ea4dbc06e44619c33d16a348a");
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTANCE_RUN, 34281332554);
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTANCE_JOB, 102246528340);
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT, 10077917851);
  assert.equal(M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT_SHA256, "91efbbfc8a3c7a2cf742d669ea4d6fafc0c49f80e90eb692df3835bdf834ce34");
  assert.equal(M3_MOTION_RENDER_P5_RESULT_SHA256, "89aa0465ae6e5291ddf4d936233e793c1587f3e97213313fc16f1b873e3aade6");
  assert.equal(M3_MOTION_RENDER_P5_PROJECT_SHA256, "ff045e3a444eac59f4e51ee3d818d08a5d078ed5a198d12d4f883c28f09f26bb");
  for (const id of expectedCapabilities) {
    assert.equal(m3MotionRenderP1P2MaturityForCapability(id), "STRUCTURAL");
    assert.equal(m3MotionRenderP3P4MaturityForCapability(id), "ROLLBACK");
    assert.equal(m3MotionRenderP5MaturityForCapability(id), "TRANSFER");
  }
});

test("active protocol 1.10 capabilities are FULL only after accepted P5 transfer", () => {
  for (const capability of M3_MOTION_RENDER_CAPABILITIES_V110) {
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
  }
  const base = { id: "ae.comp.motion_render.set", domain: "render", description: "test", status: "FULL", proofMaturity: "ROBUST", routes: [], readbackStrategy: null, visualProofProfile: null, rollbackStrategy: null, riskClass: "R1_REVERSIBLE", fallbackPolicy: "FORBID" };
  const p1p2 = applyM3MotionRenderAcceptedP1P2Evidence([base]);
  assert.equal(p1p2[0].status, "PARTIAL"); assert.equal(p1p2[0].proofMaturity, "STRUCTURAL");
  const p3p4 = applyM3MotionRenderAcceptedP3P4Evidence([base]);
  assert.equal(p3p4[0].status, "PARTIAL"); assert.equal(p3p4[0].proofMaturity, "ROLLBACK");
  const p5 = applyM3MotionRenderAcceptedP5Evidence([base]);
  assert.equal(p5[0].status, "FULL"); assert.equal(p5[0].proofMaturity, "TRANSFER");
  const unknown = applyM3MotionRenderAcceptedP5Evidence([{ ...base, id: "ae.motion_render.future" }]);
  assert.equal(unknown[0].status, "PARTIAL"); assert.equal(unknown[0].proofMaturity, "DECLARED");
});

test("P1/P2 acceptance remains structural-only", async () => {
  const acceptance = JSON.parse(await readFile(p1P2AcceptancePath, "utf8"));
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.provenance.acceptedSourceCommit, M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT);
  assert.equal(acceptance.proofLevels.P2_structural_readback, true);
  assert.equal(acceptance.proofLevels.P5_save_reopen_reconnect_transfer, false);
});

test("P3/P4 acceptance remains rollback-only and does not retroactively claim P5", async () => {
  const acceptance = await readFile(p3P4AcceptancePath, "utf8");
  assert.match(acceptance, /\*\*P3 is accepted by independent retained-artifact review/);
  assert.match(acceptance, /\*\*P4 is accepted for both composition and layer motion-render mutation families/);
  assert.match(acceptance, /P5 save\/reopen\/reconnect transfer is the next separate tranche/);
});

test("P5 acceptance pins exact transfer evidence and authorizes FULL TRANSFER promotion", async () => {
  const acceptance = await readFile(p5AcceptancePath, "utf8");
  assert.match(acceptance, /Feature source commit under proof: `79dabd7573d99fc8b0664032d54658d65bc1cf02`/);
  assert.match(acceptance, /Isolated control\/trigger commit: `364055888dcb404ea4dbc06e44619c33d16a348a`/);
  assert.match(acceptance, /GitHub Actions real-AE run: `34281332554`/);
  assert.match(acceptance, /Real-AE job: `102246528340`/);
  assert.match(acceptance, /artifact id `10077917851`/);
  assert.match(acceptance, /Artifact ZIP digest: `sha256:91efbbfc8a3c7a2cf742d669ea4d6fafc0c49f80e90eb692df3835bdf834ce34`/);
  assert.match(acceptance, /distinct authenticated CEP session/);
  assert.match(acceptance, /native layer id `25`/);
  assert.match(acceptance, /P5 save\/reopen\/reconnect transfer is accepted/);
  assert.match(acceptance, /`FULL`\/`TRANSFER`/);
  assert.match(acceptance, /does not claim `ROBUST` maturity/);
});
