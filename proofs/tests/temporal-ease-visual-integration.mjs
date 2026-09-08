// Real FFmpeg execution against synthetic media. Not a real-AE proof.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, copyFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEvidenceVideo, reviewEvidence, RENDERS, FIXTURE } from "../../scripts/proofs/verify-temporal-ease-visual.mjs";
import { syntheticDecoded, syntheticRecords } from "./temporal-ease-visual-fixtures.mjs";

const verifierPath = fileURLToPath(new URL("../../scripts/proofs/verify-temporal-ease-visual.mjs", import.meta.url));
const ffmpeg = process.env.EDITFLOW_TEST_FFMPEG ?? "ffmpeg";
const ffprobe = process.env.EDITFLOW_TEST_FFPROBE ?? "ffprobe";
const encode = (pixels, outputPath, fps = 24) => {
  execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "320x320",
    "-framerate", String(fps), "-i", "pipe:0", "-threads", "1", "-c:v", "rawvideo", "-pix_fmt", "bgr24", "-f", "avi", outputPath],
  { input: pixels, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
};

test("actual FFmpeg / ffprobe decode and CLI are fail-closed on retained synthetic evidence", async (t) => {
  // Missing binaries fail this explicit integration suite; no silent skips.
  execFileSync(ffmpeg, ["-version"], { timeout: 5000 });
  execFileSync(ffprobe, ["-version"], { timeout: 5000 });
  const root = await mkdtemp(path.join(tmpdir(), "editflow-temporal-ease-verifier-"));
  try {
    const decoded = syntheticDecoded();
    const records = syntheticRecords();
    const proofPath = path.join(root, "result.json");
    const acceptedP1P2Path = path.join(root, "accepted-p1-p2.json");
    await writeFile(proofPath, JSON.stringify(records.proof));
    await writeFile(acceptedP1P2Path, records.dependencyBytes);
    const baseline = path.join(root, RENDERS.baselineRender);
    const eased = path.join(root, RENDERS.easedRender);
    const restored = path.join(root, RENDERS.restoredBaselineRender);
    const rollback = path.join(root, RENDERS.postRollbackRender);
    encode(decoded.baselineRender, baseline);
    encode(decoded.easedRender, eased);
    await copyFile(baseline, restored);
    await copyFile(baseline, rollback);
    const options = { proofPath, acceptedP1P2Path, ffmpeg, ffprobe };

    await t.test("valid synthetic media passes while real-AE visual acceptance remains false", async () => {
      const result = await reviewEvidence(options);
      assert.equal(result.ok, true);
      assert.equal(result.status, "PIXEL_CHECKS_PASSED_REVIEW_REQUIRED");
      assert.equal(result.P3_visual_proof, false);
      assert.equal(result.P5_save_reopen_reconnect_transfer, false);
      assert.equal(result.independentReviewRequired, true);
      assert.equal(result.evidenceKind, "SYNTHETIC_VERIFIER_TEST_NOT_AE");
      assert.equal(result.artifacts.baselineRender.metadata.frames.length, 24);
      assert.deepEqual(result.unrenderedKeyframeTimesSeconds, [1]);
    });

    await t.test("CLI reports the same truthful review-required state without overwriting input", async () => {
      const before = await readFile(proofPath);
      const stdout = execFileSync(process.execPath, [verifierPath, "--proof", proofPath, "--accepted-p1-p2", acceptedP1P2Path,
        "--ffmpeg", ffmpeg, "--ffprobe", ffprobe], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
      assert.equal(JSON.parse(stdout).ok, true);
      assert.equal(JSON.parse(stdout).P3_visual_proof, false);
      assert.deepEqual(await readFile(proofPath), before);
    });

    await t.test("different AVI metadata is not mistaken for a failed pixel restoration", async () => {
      execFileSync(ffmpeg, ["-v", "error", "-y", "-i", baseline, "-map", "0:v:0", "-c:v", "copy", "-metadata",
        "comment=SYNTHETIC_REPACK_NOT_AE", "-f", "avi", restored], { timeout: 15000 });
      const result = await reviewEvidence(options);
      assert.equal(result.ok, true);
      assert.notEqual(result.artifacts.baselineRender.encodedSha256, result.artifacts.restoredBaselineRender.encodedSha256);
      assert.equal(result.decodedSha256.baselineRender, result.decodedSha256.restoredBaselineRender);
    });

    await t.test("one corrupt rollback pixel outside the old sample times fails full-frame equivalence", async () => {
      const corrupt = Buffer.from(decoded.baselineRender);
      corrupt[7 * FIXTURE.width * FIXTURE.height * 3 + 111] ^= 1;
      encode(corrupt, rollback);
      const result = await reviewEvidence(options);
      assert.equal(result.ok, false);
      assert.equal(result.checks.exact_rollback_all_frames, false);
      assert.equal(result.P3_visual_proof, false);
      await copyFile(baseline, rollback);
    });

    await t.test("an unchanged rendered file cannot masquerade as an ease mutation", async () => {
      await copyFile(baseline, eased);
      const result = await reviewEvidence(options);
      assert.equal(result.ok, false);
      assert.equal(result.checks.visible_incoming_ease, false);
      assert.equal(result.checks.visible_outgoing_ease, false);
      encode(decoded.easedRender, eased);
    });

    await t.test("24 frames at the wrong frame rate are rejected before comparison", async () => {
      const wrongRate = path.join(root, "wrong-rate.avi");
      encode(decoded.baselineRender, wrongRate, 30);
      await assert.rejects(decodeEvidenceVideo(wrongRate, { ffmpeg, ffprobe }), { code: "VIDEO_FRAME_RATE" });
    });

    await t.test("a truncated AVI cannot pass by decoding only the available prefix", async () => {
      const truncated = path.join(root, "truncated.avi");
      await writeFile(truncated, (await readFile(baseline)).subarray(0, 100));
      await assert.rejects(decodeEvidenceVideo(truncated, { ffmpeg, ffprobe }), { code: "MEDIA_TOOL_FAILED" });
    });

    await t.test("symlinked media is rejected instead of following a substituted artifact", async () => {
      await rm(rollback);
      await symlink(baseline, rollback);
      await assert.rejects(reviewEvidence(options), { code: "EVIDENCE_FILE" });
      await rm(rollback);
      await copyFile(baseline, rollback);
    });

    await t.test("a mismatched dependency is rejected before any media subprocess is invoked", async () => {
      await writeFile(acceptedP1P2Path, Buffer.concat([records.dependencyBytes, Buffer.from("\n")]));
      await assert.rejects(reviewEvidence({ ...options, ffmpeg: "nonexistent-editflow-decoder", ffprobe: "nonexistent-editflow-probe" }), { code: "DEPENDENCY_HASH" });
      await writeFile(acceptedP1P2Path, records.dependencyBytes);
    });

    await t.test("missing media tools are explicit failures, not skipped evidence checks", async () => {
      await assert.rejects(decodeEvidenceVideo(baseline, { ffmpeg, ffprobe: "nonexistent-editflow-probe" }), { code: "MEDIA_TOOL_FAILED" });
    });

    await t.test("unknown CLI arguments return structured failure and nonzero exit", () => {
      assert.throws(() => execFileSync(process.execPath, [verifierPath, "--accept-p3", "true"], { encoding: "utf8" }), (error) => {
        assert.equal(error.status, 1);
        const result = JSON.parse(error.stdout);
        assert.equal(result.code, "CLI_ARGUMENTS");
        assert.equal(result.P3_visual_proof, false);
        return true;
      });
    });
  } finally {
    // This test deletes only its own newly allocated temporary directory.
    await rm(root, { recursive: true, force: true });
  }
});
