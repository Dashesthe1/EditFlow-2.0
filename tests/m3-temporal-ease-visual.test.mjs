import test from "node:test";
import assert from "node:assert/strict";
import { compareDecodedRenders, frameDifference, validateEvidenceRecord, validateVideoMetadata, FIXTURE } from "../scripts/proofs/verify-temporal-ease-visual.mjs";
import { syntheticDecoded, syntheticMetadata, syntheticRecords } from "../proofs/tests/temporal-ease-visual-fixtures.mjs";

const original = syntheticDecoded();
const frameBytes = FIXTURE.width * FIXTURE.height * 3;

test("synthetic visible two-sided easing passes numerical screening without making an AE claim", () => {
  const result = compareDecodedRenders(original);
  assert.equal(result.ok, true);
  assert.equal(result.visibleIncomingFrames.length >= 2, true);
  assert.equal(result.visibleOutgoingFrames.length >= 2, true);
  assert.equal(result.comparisons.length, 24);
  assert.equal(result.renderedFrameTimesSeconds.at(-1), 23 / 24);
  assert.deepEqual(result.unrenderedKeyframeTimesSeconds, [1]);
  assert.equal(result.renderedFrameTimesSeconds.includes(1), false);
  assert.equal(result.decodedSha256.baselineRender, result.decodedSha256.restoredBaselineRender);
});

test("an unchanged rendered sequence is not accepted as visible ease", () => {
  const result = compareDecodedRenders({ ...original, easedRender: original.baselineRender });
  assert.equal(result.ok, false);
  assert.equal(result.checks.visible_incoming_ease, false);
  assert.equal(result.checks.visible_outgoing_ease, false);
});

test("one changed pixel and sub-threshold full-frame noise cannot count as visible timing", () => {
  const noise = Buffer.from(original.baselineRender);
  for (let index = 1; index < 24; index += 1) {
    if (index === 12) continue;
    for (let offset = index * frameBytes; offset < (index + 1) * frameBytes; offset += 1) noise[offset] += 1;
    noise[index * frameBytes] = 255;
  }
  const result = compareDecodedRenders({ ...original, easedRender: noise });
  assert.equal(result.checks.visible_incoming_ease, false);
  assert.equal(result.checks.visible_outgoing_ease, false);
});

test("one-sided ease does not satisfy both incoming and outgoing controls", () => {
  const oneSide = Buffer.from(original.easedRender);
  original.baselineRender.copy(oneSide, 13 * frameBytes, 13 * frameBytes);
  const result = compareDecodedRenders({ ...original, easedRender: oneSide });
  assert.equal(result.checks.visible_incoming_ease, true);
  assert.equal(result.checks.visible_outgoing_ease, false);
  assert.equal(result.ok, false);
});

for (const [role, check] of [["restoredBaselineRender", "exact_restore_all_frames"], ["postRollbackRender", "exact_rollback_all_frames"]]) {
  test(`${role}: one changed channel at an unsampled intermediate frame rejects exact restoration`, () => {
    const corrupt = Buffer.from(original.baselineRender);
    corrupt[7 * frameBytes + 111] ^= 1;
    const result = compareDecodedRenders({ ...original, [role]: corrupt });
    assert.equal(result.checks[check], false);
    assert.equal(result.ok, false);
  });
}

for (const [frame, check] of [[0, "first_key_pixels_unchanged"], [12, "middle_key_pixels_unchanged"]]) {
  test(`rendered keyframe ${frame} must remain byte-exact`, () => {
    const corrupt = Buffer.from(original.easedRender);
    corrupt[frame * frameBytes] ^= 1;
    assert.equal(compareDecodedRenders({ ...original, easedRender: corrupt }).checks[check], false);
  });
}

test("static or black baseline cannot pass merely because another render differs", () => {
  const black = Buffer.alloc(original.baselineRender.length);
  assert.equal(compareDecodedRenders({ ...original, baselineRender: black }).checks.baseline_is_not_static, false);
});

for (const delta of [-1, 1, -frameBytes, frameBytes]) {
  test(`decoded length delta ${delta} fails closed`, () => {
    assert.throws(() => compareDecodedRenders({ ...original, baselineRender: Buffer.alloc(original.baselineRender.length + delta) }), { code: "DECODED_LENGTH" });
  });
}

test("incomplete RGB frames are rejected", () => {
  assert.throws(() => frameDifference(Buffer.alloc(3), Buffer.alloc(3)), { code: "FRAME_BYTES" });
});

test("exact media metadata and presentation times pass", () => assert.doesNotThrow(() => validateVideoMetadata(syntheticMetadata())));

for (const [name, mutate, code] of [
  ["missing stream", (m) => { m.streams = []; }, "VIDEO_STREAM_COUNT"],
  ["extra video stream", (m) => { m.streams.push({ ...m.streams[0] }); }, "VIDEO_STREAM_COUNT"],
  ["null stream", (m) => { m.streams[0] = null; }, "VIDEO_DIMENSIONS"],
  ["null frame", (m) => { m.frames[0] = null; }, "VIDEO_TIMESTAMPS"],
  ["resized canvas", (m) => { m.streams[0].width = 640; }, "VIDEO_DIMENSIONS"],
  ["retimed rate", (m) => { m.streams[0].avg_frame_rate = "30/1"; }, "VIDEO_FRAME_RATE"],
  ["zero denominator", (m) => { m.streams[0].r_frame_rate = "24/0"; }, "VIDEO_FRAME_RATE"],
  ["dropped frame", (m) => { m.frames.pop(); }, "VIDEO_FRAME_COUNT"],
  ["padded terminal frame", (m) => { m.frames.push({ ...m.frames.at(-1), best_effort_timestamp_time: "1.000000" }); }, "VIDEO_FRAME_COUNT"],
  ["duplicate timestamp", (m) => { m.frames[7].best_effort_timestamp_time = m.frames[6].best_effort_timestamp_time; }, "VIDEO_TIMESTAMPS"],
  ["missing timestamp", (m) => { delete m.frames[0].best_effort_timestamp_time; }, "VIDEO_TIMESTAMPS"],
  ["null timestamp", (m) => { m.frames[0].best_effort_timestamp_time = null; }, "VIDEO_TIMESTAMPS"],
  ["blank timestamp", (m) => { m.frames[0].best_effort_timestamp_time = ""; }, "VIDEO_TIMESTAMPS"],
  ["nonfinite timestamp", (m) => { m.frames[0].best_effort_timestamp_time = "Infinity"; }, "VIDEO_TIMESTAMPS"],
  ["changed frame dimensions", (m) => { m.frames[7].height = 640; }, "VIDEO_FRAME_DIMENSIONS"],
]) {
  test(`metadata rejects ${name}`, () => {
    const metadata = syntheticMetadata();
    mutate(metadata);
    assert.throws(() => validateVideoMetadata(metadata), { code });
  });
}

test("Windows artifact paths and an exact retained dependency hash validate cross-platform", () => {
  const { proof, dependency, dependencyBytes } = syntheticRecords();
  assert.doesNotThrow(() => validateEvidenceRecord(proof, dependency, dependencyBytes));
});

for (const [name, mutate, code] of [
  ["wrong proof", (p) => { p.proofId = "OTHER"; }, "PROOF_IDENTITY"],
  ["failed harness", (p) => { p.ok = false; }, "PROOF_NOT_READY"],
  ["self-accepted status", (p) => { p.status = "ACCEPTED"; }, "PROOF_NOT_READY"],
  ["cleanup error", (p) => { p.cleanupErrors.push("failure"); }, "PROOF_CLEANUP"],
  ["missing cleanup", (p) => { p.cleanupComplete = false; }, "PROOF_CLEANUP"],
  ["P3 overclaim", (p) => { p.proofLevels.P3_visual_proof = true; }, "PROOF_LEVELS"],
  ["P4 missing", (p) => { p.proofLevels.P4_failure_injection_rollback = false; }, "PROOF_LEVELS"],
  ["P5 overclaim", (p) => { p.proofLevels.P5_save_reopen_reconnect_transfer = true; }, "PROOF_LEVELS"],
  ["bad dependency hash", (p) => { p.acceptedP1P2.sha256 = "0".repeat(64); }, "DEPENDENCY_HASH"],
  ["wrong key times", (p) => { p.fixture.keyframes[1].time = 0.6; }, "FIXTURE_IDENTITY"],
  ["wrong property", (p) => { p.fixture.propertyPath[1] = "ADBE Scale"; }, "FIXTURE_IDENTITY"],
  ["wrong recorded asset", (p) => { p.visualReviewSpec.easedRender = "file:///etc/passwd"; }, "RENDER_PATHS"],
]) {
  test(`evidence gating rejects ${name}`, () => {
    const { proof, dependency, dependencyBytes } = syntheticRecords();
    mutate(proof);
    assert.throws(() => validateEvidenceRecord(proof, dependency, dependencyBytes), { code });
  });
}

test("dependency bytes, not reserialized parsed JSON, determine the provenance binding", () => {
  const { proof, dependency, dependencyBytes } = syntheticRecords();
  assert.throws(() => validateEvidenceRecord(proof, dependency, Buffer.concat([dependencyBytes, Buffer.from("\n")])), { code: "DEPENDENCY_HASH" });
});

test("an unsuccessful retained P1/P2 dependency is rejected", () => {
  const { proof, dependency, dependencyBytes } = syntheticRecords();
  dependency.ok = false;
  assert.throws(() => validateEvidenceRecord(proof, dependency, dependencyBytes), { code: "DEPENDENCY_NOT_ACCEPTABLE" });
});
