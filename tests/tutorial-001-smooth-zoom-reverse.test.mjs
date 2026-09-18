import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  learnDeepFromTutorialUploadV1,
  selectTutorialProofStagesV1,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";
import {
  AE_CEP_PUBLIC_CAPABILITIES_V11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import {
  applyM2AcceptedProofEvidence,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m2-proof-maturity.js";
import {
  M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import {
  M3_TEMPORAL_EASE_CAPABILITIES_V18,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-ease.js";
import {
  M5_TIME_REMAP_CAPABILITIES_V27,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-time-remap.js";

const fixturePath =
  "tests/fixtures/tutorials/smooth-zoom-reverse-v1.json";

const loadPacket = async () =>
  JSON.parse(await readFile(fixturePath, "utf8"));

const registryForTutorial001 = () => {
  const registry = new CapabilityRegistry(
    "env:tutorial-001:ae-25.6.6",
    "2026-09-17T21:00:00.000Z",
  );
  registry.registerStatic([
    ...applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11),
    ...M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
    ...M3_TEMPORAL_EASE_CAPABILITIES_V18,
    ...M5_TIME_REMAP_CAPABILITIES_V27,
  ]);
  return registry;
};

const upload = {
  uploadId: "tutorial-001",
  mediaRef: "gdrive://18VN6VBc8Bsig2D5itq3_zfG4PTuc6vSq",
};

const learn = async () => {
  const packet = await loadPacket();
  return await learnDeepFromTutorialUploadV1(
    upload,
    { analyze: async () => packet },
    registryForTutorial001(),
    {
      generatedAt: "2026-09-17T21:01:00.000Z",
      targetState: "TRANSFER_VERIFIED",
    },
  );
};

test("Tutorial 1 compiles into semantic velocity-plus-zoom Editing IR", async () => {
  const result = await learn();
  const skill = result.lesson.skills[0];

  assert.equal(result.lesson.tutorialId, "tutorial.smooth-zoom-reverse.001");
  assert.equal(skill.analysis.skillId, "skill.velocity-zoom-transition");
  assert.deepEqual(
    skill.editingIr.nodes.map((node) => node.kind),
    ["PRECOMPOSE", "TIME_REMAP", "TIME_REMAP", "CAMERA_PUSH"],
  );
  assert.equal(
    skill.editingIr.nodes.some((node) => node.kind === "REVERSE_TIME"),
    false,
  );
  assert.deepEqual(skill.editingIr.outputs, ["couple-zoom-pulse"]);
  assert.deepEqual(
    skill.editingIr.nodes.find((node) => node.nodeId === "couple-zoom-pulse").dependsOn,
    ["shape-temporal-velocity-pulse"],
  );

  const contradiction = skill.analysis.knowledgeDelta.contradictions.join(" ");
  assert.match(contradiction, /not established strongly enough to hardcode REVERSE_TIME/i);
  assert.ok(skill.analysis.how.adaptationRules.some((rule) =>
    /Sapphire S_WarpTransform is unavailable/i.test(rule)));
});

test("Tutorial 1 capability map reuses mature primitives and exposes only real nonoptional gaps", async () => {
  const result = await learn();
  const findings = new Map(
    result.capabilityReport.findings.map((finding) => [
      String(finding.capabilityId),
      finding,
    ]),
  );

  assert.equal(result.capabilityReport.summary.total, 9);
  assert.equal(result.capabilityReport.summary.ready, 3);
  assert.equal(result.capabilityReport.summary.blocked, 3);
  assert.equal(result.capabilityReport.summary.optionalGaps, 3);

  assert.equal(findings.get("ae.precompose.layers").state, "READY");
  assert.equal(
    findings.get("ae.property.temporal_interpolation.set").state,
    "READY",
  );
  assert.equal(findings.get("ae.property.temporal_ease.set").state, "READY");

  assert.equal(findings.get("ae.layer.time_remap.enable").state, "PARTIAL");
  assert.equal(
    findings.get("ae.layer.time_remap.enable").actualProofMaturity,
    "STRUCTURAL",
  );
  assert.equal(findings.get("ae.keyframe.set").state, "PARTIAL");
  assert.equal(findings.get("ae.layer.transform.set").state, "PARTIAL");

  assert.equal(findings.get("ae.effect.add").state, "PARTIAL");
  assert.ok(findings.get("ae.effect.add").uses.every((use) => use.optional));
  assert.equal(findings.get("ae.effect.property.set").state, "PARTIAL");
  assert.ok(
    findings.get("ae.effect.property.set").uses.every((use) => use.optional),
  );

  assert.equal(
    findings.get("ae.plugin.sapphire.s_warp_transform").state,
    "UNREGISTERED",
  );
  assert.ok(
    findings.get("ae.plugin.sapphire.s_warp_transform").uses.every(
      (use) => use.optional,
    ),
  );

  assert.deepEqual(result.blockingCapabilityIds, [
    "ae.keyframe.set",
    "ae.layer.time_remap.enable",
    "ae.layer.transform.set",
  ]);
  assert.equal(result.readyForReconstruction, false);
});

test("optional literal plugin routes do not block the Tutorial 1 proof funnel", async () => {
  const result = await learn();
  const plan = result.proofPlans[0];

  assert.equal(plan.risk, "HIGH");
  assert.deepEqual(plan.blockedByCapabilities, [
    "ae.keyframe.set",
    "ae.layer.time_remap.enable",
    "ae.layer.transform.set",
  ]);
  assert.deepEqual(plan.reusableCapabilityProofs, [
    "ae.precompose.layers",
    "ae.property.temporal_ease.set",
    "ae.property.temporal_interpolation.set",
  ]);

  const l2 = plan.stages.find((stage) => stage.level === 2);
  assert.ok(l2);
  assert.equal(l2.required, false);
  assert.equal(l2.liveAeRequired, false);
  assert.deepEqual(l2.assertions, []);

  const selection = selectTutorialProofStagesV1({
    plan,
    stageContexts: {},
  });
  assert.equal(selection.nextStageId, "skill.velocity-zoom-transition:L0");
  assert.deepEqual(selection.blockedStageIds, [
    "skill.velocity-zoom-transition:L3",
    "skill.velocity-zoom-transition:L4",
    "skill.velocity-zoom-transition:L5",
    "skill.velocity-zoom-transition:L6",
  ]);
  assert.deepEqual(selection.plannedRunStageIds, [
    "skill.velocity-zoom-transition:L0",
    "skill.velocity-zoom-transition:L1",
  ]);
});

test("Tutorial 1 stores adaptation and review rules instead of tutorial constants", async () => {
  const result = await learn();
  const skill = result.lesson.skills[0].analysis;

  assert.ok(skill.how.adaptationRules.some((rule) => /frame rate/i.test(rule)));
  assert.ok(skill.how.adaptationRules.some((rule) => /crop headroom/i.test(rule)));
  assert.ok(skill.how.adaptationRules.some((rule) => /hero subject/i.test(rule)));
  assert.ok(skill.proof.invariants.some((rule) => /optional plugin absence/i.test(rule)));
  assert.ok(skill.proof.failureModes.some((failure) =>
    /freeze, stutter, or duplicate-frame plateau/i.test(failure.condition)));
  assert.deepEqual(skill.proof.transferAxes, [
    "different frame rate",
    "different shot duration and source-handle length",
    "different subject scale and off-center subject position",
    "different source motion speed and direction",
    "portrait versus landscape aspect ratio",
    "beat-driven versus motion-driven transition anchor",
  ]);
});
