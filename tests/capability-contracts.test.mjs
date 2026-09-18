import test from "node:test";
import assert from "node:assert/strict";

import {
  generateCapabilityProofCasesV1,
  validateCapabilityContractAgainstRecordV1,
  validateCapabilityContractInputV1,
  validateCapabilityProofContractV1,
} from "../.tmp/runtime/packages/capability-contracts/src/index.js";

const contract = () => ({
  schema: "editflow.capability-proof-contract.v1",
  capabilityId: "ae.effect.property.set",
  riskClass: "R1_REVERSIBLE",
  dependencies: ["ae.effect.add"],
  supportedRouteKinds: ["HOST_ADAPTER"],
  inputFields: [{
    name: "layerId",
    type: "STRING",
    required: true,
    nominal: "layer.hero",
  }, {
    name: "effectId",
    type: "STRING",
    required: true,
    nominal: "fx.blur",
  }, {
    name: "amount",
    type: "NUMBER",
    required: true,
    nominal: 25,
    min: 0,
    max: 100,
  }, {
    name: "mode",
    type: "ENUM",
    required: true,
    nominal: "GAUSSIAN",
    enumValues: ["GAUSSIAN", "BOX"],
  }, {
    name: "enabled",
    type: "BOOLEAN",
    required: true,
    nominal: true,
  }],
  readbackAssertions: [
    "Readback returns the same semantic property value.",
  ],
  rollbackAssertions: [
    "Rollback restores the pre-operation semantic property snapshot.",
  ],
  edgeConditions: [
    "Effect instance must still belong to the declared layer.",
  ],
  edgeCases: [{
    edgeId: "stale-effect-owner",
    input: {
      layerId: "layer.other",
      effectId: "fx.blur",
      amount: 25,
      mode: "GAUSSIAN",
      enabled: true,
    },
    expectedOutcome: "REJECT",
    assertions: [
      "Adapter rejects an effect binding that no longer belongs to the target layer.",
    ],
  }],
});

test("capability contracts generate standard proof cases from one declaration", () => {
  const cases = generateCapabilityProofCasesV1(contract());
  const ids = cases.map((entry) => entry.caseId);
  assert.ok(ids.includes("nominal"));
  assert.ok(ids.includes("readback"));
  assert.ok(ids.includes("rollback"));
  assert.ok(ids.includes("boundary:amount:min"));
  assert.ok(ids.includes("boundary:amount:max"));
  assert.ok(ids.includes("invalid:amount:below-min"));
  assert.ok(ids.includes("invalid:amount:above-max"));
  assert.ok(ids.includes("invalid:mode:type"));
  assert.ok(ids.includes("edge:stale-effect-owner"));
  assert.equal(new Set(ids).size, ids.length);
});

test("generated generic accept/reject cases agree with Level-0 contract validation", () => {
  const declared = contract();
  const cases = generateCapabilityProofCasesV1(declared)
    .filter((entry) => entry.kind !== "EDGE_CASE");
  for (const proofCase of cases) {
    const validation = validateCapabilityContractInputV1(
      declared,
      proofCase.input,
    );
    assert.equal(
      validation.valid,
      proofCase.expectedOutcome === "ACCEPT",
      proofCase.caseId + ": " + validation.errors.join(" | "),
    );
  }
});

test("contract validation fails closed for contradictory ranges and rollback omissions", () => {
  const invalid = contract();
  invalid.inputFields[2].min = 200;
  invalid.inputFields[2].max = 100;
  invalid.rollbackAssertions = [];
  const validation = validateCapabilityProofContractV1(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /min cannot exceed max/i);
  assert.match(validation.errors.join("\n"), /rollbackAssertions/i);
});

test("read-only contracts do not invent rollback proofs", () => {
  const readOnly = {
    ...contract(),
    capabilityId: "ae.project.inspect",
    riskClass: "R0_READ_ONLY",
    dependencies: [],
    rollbackAssertions: [],
    edgeCases: [],
  };
  const validation = validateCapabilityProofContractV1(readOnly);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const cases = generateCapabilityProofCasesV1(readOnly);
  assert.equal(cases.some((entry) => entry.kind === "ROLLBACK"), false);
});

test("identical numeric min/max generates one boundary proof, not duplicate evidence", () => {
  const fixed = contract();
  fixed.inputFields[2].nominal = 50;
  fixed.inputFields[2].min = 50;
  fixed.inputFields[2].max = 50;
  const cases = generateCapabilityProofCasesV1(fixed)
    .filter((entry) => entry.kind === "BOUNDARY" && entry.caseId.includes("amount"));
  assert.equal(cases.length, 1);
  assert.equal(cases[0].caseId, "boundary:amount:min");
});

test("capability contract is checked against live registry metadata before use", () => {
  const record = {
    id: "ae.effect.property.set",
    domain: "effect",
    description: "Set a typed effect property.",
    status: "FULL",
    proofMaturity: "TRANSFER",
    routes: [{
      routeId: "route.effect-property",
      kind: "HOST_ADAPTER",
      available: true,
    }],
    readbackStrategy: "SEMANTIC",
    rollbackStrategy: "SNAPSHOT",
    riskClass: "R1_REVERSIBLE",
    fallbackPolicy: "FORBID",
  };
  const matching = validateCapabilityContractAgainstRecordV1(contract(), record);
  assert.equal(matching.valid, true, matching.errors.join("\n"));

  const wrongRisk = {
    ...record,
    riskClass: "R2_STRUCTURAL",
  };
  const mismatch = validateCapabilityContractAgainstRecordV1(contract(), wrongRisk);
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.errors.join("\n"), /riskClass/i);
});
