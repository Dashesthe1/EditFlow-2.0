import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePracticeReferenceCoverageV1,
  validatePracticeSceneMatchesV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-mastery-verifier.js";

const shots = [
  { shotId: "shot:1", order: 0, referenceStartMs: 0, referenceEndMs: 1000, evidenceRefs: [] },
  { shotId: "shot:2", order: 1, referenceStartMs: 1000, referenceEndMs: 2000, evidenceRefs: [] },
  { shotId: "shot:3", order: 2, referenceStartMs: 2000, referenceEndMs: 3000, evidenceRefs: [] },
];

const match = (shotId, sourceId = "video:raw") => ({
  shotId,
  sourceId,
  sourcePath: "C:\\Media\\raw.mp4",
  sourceStartMs: 100,
  sourceEndMs: 1100,
  direction: "FORWARD",
  playbackRate: 1,
  appearanceSimilarity: 0.99,
  temporalSimilarity: 0.99,
  motionSimilarity: 0.99,
  geometricProof: {
    anchorCount: 4,
    strongAnchorCount: 3,
    strongAnchorFraction: 0.75,
    meanSupport: 0.92,
    minimumSupport: 0.81,
    maximumInlierCount: 18,
    meanInlierRatio: 0.78,
    meanCoverage: 0.21,
  },
  confidence: 0.99,
  evidenceRefs: ["source-video:sha256:abc123"],
});

test("Practice mastery requires whole-reference shot coverage", () => {
  assert.deepEqual(validatePracticeReferenceCoverageV1(shots, 3000, 30), []);

  const withGap = [
    shots[0],
    { ...shots[1], referenceStartMs: 1200 },
    shots[2],
  ];
  const gapReasons = validatePracticeReferenceCoverageV1(withGap, 3000, 30);
  assert.ok(gapReasons.some((reason) => /uncovered timeline gap/.test(reason)));

  const shortTail = shots.map((shot, index) => index === 2
    ? { ...shot, referenceEndMs: 2750 }
    : shot);
  const tailReasons = validatePracticeReferenceCoverageV1(shortTail, 3000, 30);
  assert.ok(tailReasons.some((reason) => /full reference duration/.test(reason)));
});

test("Practice mastery rejects overlapping or invalid Finish decomposition", () => {
  const overlap = [
    shots[0],
    { ...shots[1], referenceStartMs: 800 },
    shots[2],
  ];
  assert.ok(validatePracticeReferenceCoverageV1(overlap, 3000, 30)
    .some((reason) => /material shot overlap/.test(reason)));
});

test("Practice mastery requires one content-addressed indexed source per shot", () => {
  const valid = shots.map((shot) => match(shot.shotId));
  assert.deepEqual(
    validatePracticeSceneMatchesV1(shots.map((shot) => shot.shotId), valid, 0.95, ["video:raw"]),
    [],
  );

  const foreign = valid.map((item, index) => index === 1
    ? match(item.shotId, "video:foreign")
    : item);
  const foreignReasons = validatePracticeSceneMatchesV1(
    shots.map((shot) => shot.shotId),
    foreign,
    0.95,
    ["video:raw"],
  );
  assert.ok(foreignReasons.some((reason) => /indexed Start video set/.test(reason)));

  const missingIdentity = valid.map((item, index) => index === 2
    ? { ...item, evidenceRefs: ["match:scene:3"] }
    : item);
  const identityReasons = validatePracticeSceneMatchesV1(
    shots.map((shot) => shot.shotId),
    missingIdentity,
    0.95,
    ["video:raw"],
  );
  assert.ok(identityReasons.some((reason) => /content-addressed video identity/.test(reason)));
});

test("Practice mastery requires repeated geometric evidence for an exact scene claim", () => {
  const strong = match("shot:1");
  assert.deepEqual(
    validatePracticeSceneMatchesV1(["shot:1"], [strong], 0.95, ["video:raw"]),
    [],
  );

  const missing = { ...strong, geometricProof: undefined };
  assert.ok(validatePracticeSceneMatchesV1(["shot:1"], [missing], 0.95, ["video:raw"])
    .some((reason) => /repeated geometric proof/.test(reason)));

  const oneAnchor = {
    ...strong,
    geometricProof: { ...strong.geometricProof, strongAnchorCount: 1, strongAnchorFraction: 0.25 },
  };
  assert.ok(validatePracticeSceneMatchesV1(["shot:1"], [oneAnchor], 0.95, ["video:raw"])
    .some((reason) => /repeated geometric proof/.test(reason)));
});

test("Practice mastery rejects a geometrically strong but source-ambiguous scene claim", () => {
  const ambiguous = {
    ...match("shot:1"),
    candidateScore: 0.82,
    runnerUpScore: 0.81,
    candidateMargin: 0.01,
  };
  assert.ok(validatePracticeSceneMatchesV1(["shot:1"], [ambiguous], 0.95, ["video:raw"])
    .some((reason) => /too ambiguous/.test(reason)));

  const distinct = { ...ambiguous, candidateMargin: 0.04 };
  assert.deepEqual(
    validatePracticeSceneMatchesV1(["shot:1"], [distinct], 0.95, ["video:raw"]),
    [],
  );
});

test("Practice mastery accepts only a trajectory-proven forward-then-rewind claim", () => {
  const base = match("shot:1");
  const proven = {
    ...base,
    temporalBehavior: "FORWARD_THEN_REWIND",
    trajectory: [
      { referenceTimeMs: 100, sourceTimeMs: 200, similarity: 0.98 },
      { referenceTimeMs: 400, sourceTimeMs: 500, similarity: 0.99 },
      { referenceTimeMs: 700, sourceTimeMs: 800, similarity: 0.99 },
      { referenceTimeMs: 900, sourceTimeMs: 620, similarity: 0.98 },
    ],
    rewind: {
      detected: true,
      referenceStartMs: 700,
      referenceEndMs: 900,
      sourceStartMs: 800,
      sourceEndMs: 620,
      rewindSpanMs: 180,
      confidence: 0.96,
    },
  };
  assert.deepEqual(
    validatePracticeSceneMatchesV1(["shot:1"], [proven], 0.95, ["video:raw"]),
    [],
  );

  const fabricated = {
    ...proven,
    trajectory: proven.trajectory.map((point, index) => ({
      ...point,
      sourceTimeMs: 200 + index * 200,
    })),
  };
  const fabricatedReasons = validatePracticeSceneMatchesV1(
    ["shot:1"],
    [fabricated],
    0.95,
    ["video:raw"],
  );
  assert.ok(fabricatedReasons.some((reason) => /does not travel forward then backward/.test(reason)));

  const inconsistent = {
    ...proven,
    rewind: { ...proven.rewind, rewindSpanMs: 700 },
  };
  const inconsistentReasons = validatePracticeSceneMatchesV1(
    ["shot:1"],
    [inconsistent],
    0.95,
    ["video:raw"],
  );
  assert.ok(inconsistentReasons.some((reason) => /inconsistent rewind span/.test(reason)));
});
