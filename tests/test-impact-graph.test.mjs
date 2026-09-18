import test from "node:test";
import assert from "node:assert/strict";

import {
  TestImpactGraphV1,
} from "../.tmp/runtime/packages/incremental-proof-engine/src/index.js";

const graph = () => new TestImpactGraphV1([
  { id: "code:trail-recipe", kind: "CODE" },
  { id: "cap:layer-duplicate", kind: "CAPABILITY" },
  { id: "recipe:subject-trail", kind: "RECIPE" },
  { id: "skill:subject-trail", kind: "SKILL" },
  { id: "tutorial:trail-001", kind: "TUTORIAL" },
  { id: "proof:trail-ir", kind: "PROOF" },
  { id: "proof:trail-transfer", kind: "PROOF" },
  { id: "benchmark:trail-transfer", kind: "BENCHMARK" },
  { id: "code:color", kind: "CODE" },
  { id: "cap:color-treatment", kind: "CAPABILITY" },
  { id: "proof:color", kind: "PROOF" },
], [
  { from: "code:trail-recipe", to: "cap:layer-duplicate" },
  { from: "cap:layer-duplicate", to: "recipe:subject-trail" },
  { from: "recipe:subject-trail", to: "skill:subject-trail" },
  { from: "skill:subject-trail", to: "tutorial:trail-001" },
  { from: "recipe:subject-trail", to: "proof:trail-ir" },
  { from: "tutorial:trail-001", to: "proof:trail-transfer" },
  { from: "tutorial:trail-001", to: "benchmark:trail-transfer" },
  { from: "code:color", to: "cap:color-treatment" },
  { from: "cap:color-treatment", to: "proof:color" },
]);

test("test impact graph selects only downstream proofs and benchmarks", () => {
  const result = graph().analyze(["code:trail-recipe"]);
  assert.equal(result.requiresBroadValidation, false);
  assert.deepEqual(result.unmappedChangedIds, []);
  assert.deepEqual(result.affectedProofIds, [
    "proof:trail-ir",
    "proof:trail-transfer",
  ]);
  assert.ok(result.affectedNodeIds.includes("benchmark:trail-transfer"));
  assert.ok(result.affectedNodeIds.includes("tutorial:trail-001"));
  assert.equal(result.affectedNodeIds.includes("proof:color"), false);
  assert.equal(result.affectedNodeIds.includes("cap:color-treatment"), false);
});
test("capability changes skip unrelated upstream code while selecting dependents", () => {
  const result = graph().analyze(["cap:layer-duplicate"]);
  assert.equal(result.affectedNodeIds.includes("code:trail-recipe"), false);
  assert.equal(result.affectedNodeIds.includes("recipe:subject-trail"), true);
  assert.deepEqual(result.affectedProofIds, [
    "proof:trail-ir",
    "proof:trail-transfer",
  ]);
});

test("unmapped changes fail safe to broad validation", () => {
  const result = graph().analyze(["code:unknown-new-subsystem"]);
  assert.equal(result.requiresBroadValidation, true);
  assert.deepEqual(result.unmappedChangedIds, ["code:unknown-new-subsystem"]);
  assert.deepEqual(result.affectedProofIds, []);
});

test("mixed mapped and unmapped changes retain precise impact plus broad-validation flag", () => {
  const result = graph().analyze([
    "code:color",
    "code:unknown-new-subsystem",
    "code:color",
  ]);
  assert.equal(result.requiresBroadValidation, true);
  assert.deepEqual(result.changedNodeIds, [
    "code:color",
    "code:unknown-new-subsystem",
  ]);
  assert.deepEqual(result.affectedProofIds, ["proof:color"]);
});
test("impact traversal is cycle-safe and deterministic", () => {
  const cyclic = new TestImpactGraphV1([
    { id: "recipe:a", kind: "RECIPE" },
    { id: "skill:a", kind: "SKILL" },
    { id: "proof:a", kind: "PROOF" },
  ], [
    { from: "recipe:a", to: "skill:a" },
    { from: "skill:a", to: "recipe:a" },
    { from: "skill:a", to: "proof:a" },
  ]);
  const result = cyclic.analyze(["recipe:a"]);
  assert.deepEqual(result.affectedNodeIds, [
    "proof:a",
    "recipe:a",
    "skill:a",
  ]);
  assert.deepEqual(result.affectedProofIds, ["proof:a"]);
});

test("invalid graph references fail closed at construction", () => {
  assert.throws(() => new TestImpactGraphV1([
    { id: "code:a", kind: "CODE" },
  ], [
    { from: "code:a", to: "proof:missing" },
  ]), /unknown node/i);

  assert.throws(() => new TestImpactGraphV1([
    { id: "code:a", kind: "CODE" },
    { id: "code:a", kind: "CODE" },
  ], []), /duplicate test impact node/i);
});
