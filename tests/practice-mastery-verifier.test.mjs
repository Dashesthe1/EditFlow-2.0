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
