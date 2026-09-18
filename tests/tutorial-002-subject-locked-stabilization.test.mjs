import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { learnDeepFromTutorialUploadV1 } from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  inspectRecipeCompilerSupportV1,
  lowerCompiledRecipeToNativeAePlanV1,
  recipeParameterKeyV1,
} from "../.tmp/runtime/packages/recipe-compiler/src/index.js";
import { simulateVirtualAeV1 } from "../.tmp/runtime/packages/virtual-ae/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";
import { AE_CEP_PUBLIC_CAPABILITIES_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { applyM2AcceptedProofEvidence } from "../.tmp/runtime/packages/adapters/ae-cep/src/m2-proof-maturity.js";
import { M3_MARKER_MOTION_CAPABILITIES_V20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";
import {
  M4_STABILIZATION_READBACK_CAPABILITIES_V23,
  capabilityForStabilizationDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

const fixturePath = "tests/fixtures/tutorials/head-tracking-stabilization-v1.json";
const loadPacket = async () => JSON.parse(await readFile(fixturePath, "utf8"));

const verifiedStabilizationDriver = {
  driverId: "test.verified-stabilization-driver",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedDirections: ["FORWARD"],
  async stabilize() { return { status: "REFUSED" }; },
};

const registryForTutorial002 = () => {
  const registry = new CapabilityRegistry(
    "env:tutorial-002:ae-25.6.6",
    "2026-09-18T06:30:00.000Z",
  );
  registry.registerStatic([
    ...applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11),
    ...M3_MARKER_MOTION_CAPABILITIES_V20,
    ...M4_STABILIZATION_READBACK_CAPABILITIES_V23,
    capabilityForStabilizationDriverV1(verifiedStabilizationDriver),
  ]);
  return registry;
};

const upload = {
  uploadId: "tutorial-002",
  mediaRef: "gdrive://1BCmo2cOqyJ0XVYri2jlKXWXh9wg1hgnU",
};

const learn = async () => learnDeepFromTutorialUploadV1(
  upload,
  { analyze: async () => await loadPacket() },
  registryForTutorial002(),
  {
    generatedAt: "2026-09-18T06:31:00.000Z",
    targetState: "TRANSFER_VERIFIED",
  },
);

test("Tutorial 002 distinguishes subject tracking from inverse stabilization", async () => {
  const result = await learn();
  const skill = result.lesson.skills[0];

  assert.equal(result.lesson.tutorialId, "tutorial.subject-locked-stabilization.002");
  assert.equal(skill.analysis.skillId, "skill.subject-locked-stabilization");
  assert.deepEqual(
    skill.editingIr.nodes.map((node) => node.kind),
    ["STABILIZATION", "EFFECT_STACK", "TRANSFORM_ANIMATION", "MOTION_BLUR"],
  );
  assert.match(
    skill.analysis.knowledgeDelta.contradictions.join(" "),
    /position stabilization.*not an attachment-follow recipe/i,
  );
  assert.ok(skill.analysis.how.adaptationRules.some((rule) =>
    /track feature.*persistence.*local contrast/i.test(rule)));
  assert.equal(
    skill.editingIr.nodes.find((node) => node.nodeId === "fill-stabilization-edges")
      .parameters.find((parameter) => parameter.name === "effectMatchName").value,
    "ADBE Tile",
  );
});

test("Tutorial 002 reuses retained AE capability evidence without requesting re-proof", async () => {
  const result = await learn();
  const findings = new Map(result.capabilityReport.findings.map((finding) => [
    String(finding.capabilityId),
    finding,
  ]));

  assert.equal(result.capabilityReport.summary.total, 7);
  assert.equal(result.capabilityReport.summary.ready, 7);
  assert.equal(result.capabilityReport.summary.blocked, 0);
  assert.equal(result.capabilityReport.summary.optionalGaps, 0);

  for (const capabilityId of [
    "ae.stabilization.position.guarded_visual",
    "ae.stabilization.readback",
    "ae.effect.add",
    "ae.effect.property.set",
    "ae.layer.transform.set",
    "ae.comp.motion.set",
    "ae.layer.motion.set",
  ]) {
    assert.equal(findings.get(capabilityId).state, "READY", capabilityId);
  }
  assert.deepEqual(result.blockingCapabilityIds, []);

  const plan = result.proofPlans[0];
  assert.equal(plan.risk, "HIGH");
  assert.deepEqual(plan.blockedByCapabilities, []);
  assert.equal(plan.stages.find((stage) => stage.level === 2).required, false);
  assert.match(
    plan.stages.find((stage) => stage.level === 2).rationale,
    /no live AE re-proof adds information/i,
  );
});

test("Tutorial 002 stops before reconstruction only on genuinely unsupported compiler primitives", async () => {
  const result = await learn();
  const skill = result.lesson.skills[0];
  const support = inspectRecipeCompilerSupportV1(skill.editingIr);

  assert.deepEqual(support.virtualAeBlockedPrimitiveKinds, [
    "EFFECT_STACK",
    "STABILIZATION",
  ]);
  assert.deepEqual(support.nativeAeBlockedPrimitiveKinds, [
    "EFFECT_STACK",
    "STABILIZATION",
  ]);
  assert.deepEqual(result.virtualAeBlockedPrimitiveKinds, support.virtualAeBlockedPrimitiveKinds);
  assert.deepEqual(result.nativeAeBlockedPrimitiveKinds, support.nativeAeBlockedPrimitiveKinds);
  assert.deepEqual(result.compilerBlockedPrimitiveKinds, support.blockedPrimitiveKinds);
  assert.equal(result.readyForReconstruction, false);

  assert.ok(result.proofPlans[0].stages.find((stage) => stage.level === 0).required);
  assert.ok(result.proofPlans[0].stages.find((stage) => stage.level === 1).required);
  assert.equal(
    result.proofPlans[0].stages.find((stage) => stage.level === 2).required,
    false,
  );
});


test("Tutorial 002 static reframe and motion smoothing compile through Virtual AE and native AE", async () => {
  const result = await learn();
  const recipe = structuredClone(result.lesson.skills[0].editingIr);
  recipe.nodes = recipe.nodes.map((node) =>
    node.kind === "STABILIZATION" || node.kind === "EFFECT_STACK"
      ? { ...node, optional: true }
      : node);

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp.hero",
    compositions: [{
      compId: "comp.hero",
      name: "Hero",
      width: 640,
      height: 360,
      durationMs: 4000,
      frameRate: 30,
      layers: [{
        layerId: "layer.hero",
        name: "Hero footage",
        kind: "FOOTAGE",
        sourceRef: "source:hero",
        inMs: 0,
        outMs: 4000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };  const parameters = {
    [recipeParameterKeyV1("reframe-locked-subject", "position")]: [320, 176],
    [recipeParameterKeyV1("reframe-locked-subject", "scale")]: [118, 118],
    [recipeParameterKeyV1("smooth-residual-locked-motion", "motionBlurEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "frameBlendingType")]: "FRAME_MIX",
    [recipeParameterKeyV1("smooth-residual-locked-motion", "compMotionBlurEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "compFrameBlendingEnabled")]: true,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "shutterAngle")]: 180,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "shutterPhase")]: -90,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "samplesPerFrame")]: 16,
    [recipeParameterKeyV1("smooth-residual-locked-motion", "adaptiveSampleLimit")]: 128,
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(recipe, project, {
    compId: "comp.hero",
    eventTimesMs: {},
    roleBindings: [{ role: "hero_shot", layerIds: ["layer.hero"] }],
    parameterValues: parameters,
  });

  assert.deepEqual(compiled.skippedOptionalNodeIds, [
    "stabilize-hero-head",
    "fill-stabilization-edges",
  ]);
  assert.deepEqual(
    compiled.operations.map((operation) => operation.type),
    ["SET_PROPERTY", "SET_PROPERTY", "SET_COMP_MOTION", "SET_LAYER_MOTION"],
  );

  const simulation = simulateVirtualAeV1(project, compiled.operations);
  assert.equal(simulation.valid, true);
  assert.deepEqual(simulation.project.compositions[0].motion, {
    motionBlur: true,
    frameBlending: true,
    shutterAngle: 180,
    shutterPhase: -90,
    samplesPerFrame: 16,
    adaptiveSampleLimit: 128,
  });  assert.deepEqual(simulation.project.compositions[0].layers[0].motion, {
    motionBlur: true,
    frameBlendingType: "FRAME_MIX",
  });

  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "plan:tutorial-002-supported-tail",
    observedState: {
      projectId: "project:tutorial-002",
      projectRevision: "revision:tutorial-002",
      projectFingerprint: "project:sha256:tutorial-002",
      environmentFingerprint: "environment:sha256:tutorial-002",
    },
  });
  assert.deepEqual(
    plan.operations.map((operation) => operation.input.command),
    [
      "layer.set_transform",
      "layer.set_transform",
      "comp.motion.set",
      "layer.motion.set",
    ],
  );
  assert.deepEqual(
    plan.operations.map((operation) => String(operation.capabilityId)),
    [
      "ae.layer.transform.set",
      "ae.layer.transform.set",
      "ae.comp.motion.set",
      "ae.layer.motion.set",
    ],
  );
});
