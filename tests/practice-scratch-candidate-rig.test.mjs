import assert from "node:assert/strict";
import test from "node:test";

import { PracticeScratchCandidateRigV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("scratch rig narrows 32 candidates through 8 and 2 without GPT roundtrips", async () => {
  const rig = new PracticeScratchCandidateRigV1(4);
  const candidates = Array.from({ length: 32 }, (_, index) => ({
    candidateId: "candidate:" + index,
    value: index,
  }));
  const calls = [];
  const result = await rig.search({
    candidates,
    async evaluate(candidate, stage) {
      calls.push(stage.id + ":" + candidate.candidateId);
      const score = 1 - Math.abs(23 - candidate.value) / 32;
      return { score, definingCoverage: 1, evidenceRefs: [stage.id + ":" + candidate.candidateId] };
    },
  });
  assert.equal(result.stages.length, 3);
  assert.equal(result.stages[0].evaluated.length, 32);
  assert.equal(result.stages[1].evaluated.length, 8);
  assert.equal(result.stages[2].evaluated.length, 2);
  assert.equal(result.winner.candidate.value, 23);
  assert.equal(calls.length, 42);
});

test("scratch rig prioritizes defining coverage over cosmetic score", async () => {
  const rig = new PracticeScratchCandidateRigV1(2);
  const result = await rig.search({
    candidates: [
      { candidateId: "cosmetic", value: "cosmetic" },
      { candidateId: "defining", value: "defining" },
    ],
    funnel: [{ id: "FULL", resolutionScale: 1, maxCandidates: 2, criticalFramesOnly: false }],
    async evaluate(candidate) {
      return candidate.value === "cosmetic"
        ? { score: 0.99, definingCoverage: 0.5, evidenceRefs: [] }
        : { score: 0.92, definingCoverage: 1, evidenceRefs: [] };
    },
  });
  assert.equal(result.winner.candidate.value, "defining");
});
