/** Offline evidence screening only. Never mutates AE or promotes proof maturity. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const FIXTURE = Object.freeze({ width: 320, height: 320, frameRate: 24, frameCount: 24, pixelFormat: "rgb24" });
export const RENDER_ASSETS = Object.freeze({
  baselineRender: Object.freeze({ requested: "p3-baseline.avi", retained: "p3-baseline.mp4", marker: "p3-baseline.avi.editflow-render.json" }),
  easedRender: Object.freeze({ requested: "p3-zero-speed-high-influence.avi", retained: "p3-zero-speed-high-influence.mp4", marker: "p3-zero-speed-high-influence.avi.editflow-render.json" }),
  restoredBaselineRender: Object.freeze({ requested: "p3-restored-baseline.avi", retained: "p3-restored-baseline.mp4", marker: "p3-restored-baseline.avi.editflow-render.json" }),
  postRollbackRender: Object.freeze({ requested: "p4-post-rollback-baseline.avi", retained: "p4-post-rollback-baseline.mp4", marker: "p4-post-rollback-baseline.avi.editflow-render.json" }),
});
export const RENDERS = Object.freeze(Object.fromEntries(Object.entries(RENDER_ASSETS).map(([role, asset]) => [role, asset.requested])));
export const RETAINED_RENDERS = Object.freeze(Object.fromEntries(Object.entries(RENDER_ASSETS).map(([role, asset]) => [role, asset.retained])));
export const THRESHOLDS = Object.freeze({ meanAbsoluteDelta: 3, channelDelta: 8, changedPixelFraction: 0.25, framesPerSide: 2 });
const FRAME_BYTES = FIXTURE.width * FIXTURE.height * 3;
const VIDEO_BYTES = FRAME_BYTES * FIXTURE.frameCount;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const portableBasename = (value) => typeof value === "string" ? value.replaceAll("\\", "/").split("/").at(-1) : null;
const requireThat = (condition, code, message) => {
  if (!condition) throw Object.assign(new Error(`${code}: ${message}`), { code });
};
const parseJson = (bytes) => JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));

export function validateEvidenceRecord(proof, dependency, dependencyBytes) {
  requireThat(record(proof) && proof.proofId === "M3_TEMPORAL_EASE_P3_P4_REAL_AE", "PROOF_IDENTITY", "Wrong P3/P4 proof record.");
  requireThat(proof.ok === true && proof.status === "VISUAL_REVIEW_REQUIRED" && proof.visualReviewRequired === true,
    "PROOF_NOT_READY", "The structural harness must finish without self-accepting P3.");
  requireThat(proof.cleanupComplete === true && Array.isArray(proof.cleanupErrors) && proof.cleanupErrors.length === 0 && proof.failureError === null,
    "PROOF_CLEANUP", "Failed or incomplete cleanup cannot enter visual review.");
  const levels = proof.proofLevels;
  requireThat(record(levels) && levels.P1_validation_rejection === true && levels.P2_structural_readback === true
    && levels.P3_visual_artifact_emitted === true && levels.P3_visual_proof === false
    && levels.P4_failure_injection_rollback === true && levels.P5_save_reopen_reconnect_transfer === false,
    "PROOF_LEVELS", "Missing prerequisite evidence or overstated proof maturity.");
  requireThat(record(dependency) && dependency.schemaVersion === 1 && dependency.proof === "M3_TEMPORAL_EASE_P1_P2_REAL_AE"
    && dependency.protocolVersion === "1.8.0" && dependency.ok === true && dependency.cleanupComplete === true,
    "DEPENDENCY_NOT_ACCEPTABLE", "Wrong or unsuccessful retained P1/P2 result.");
  const prior = dependency.proofLevels;
  requireThat(record(prior) && prior.P1_validation_rejection === true && prior.P2_structural_readback === true
    && prior.P3_visual_proof === false && prior.P4_failure_injection_rollback === false && prior.P5_save_reopen_reconnect_transfer === false,
    "DEPENDENCY_LEVELS", "P1/P2 record has inconsistent proof levels.");
  requireThat(record(proof.acceptedP1P2) && /^[a-f0-9]{64}$/.test(proof.acceptedP1P2.sha256)
    && proof.acceptedP1P2.sha256 === digest(dependencyBytes), "DEPENDENCY_HASH", "Retained P1/P2 bytes do not match the bound SHA-256.");
  const fixture = proof.fixture;
  requireThat(record(fixture) && fixture.keyIndex === 2
    && JSON.stringify(fixture.propertyPath) === JSON.stringify(["ADBE Transform Group", "ADBE Opacity"])
    && Array.isArray(fixture.keyframes) && fixture.keyframes.length === 3
    && fixture.keyframes.every((key, index) => record(key) && key.time === [0, 0.5, 1][index] && key.value === [0, 100, 0][index]),
    "FIXTURE_IDENTITY", "This verifier covers only the fixed three-key Opacity fixture.");
  requireThat(record(proof.visualReviewSpec), "RENDER_PATHS", "Missing recorded render paths.");
  for (const [role, asset] of Object.entries(RENDER_ASSETS)) {
    const recorded = proof.visualReviewSpec[role];
    // A downloaded Windows artifact is reviewed on Windows, Linux, or macOS.
    // Never follow the absolute runner path or a directory supplied by the record.
    requireThat(typeof recorded === "string" && portableBasename(recorded) === asset.requested,
      "RENDER_PATHS", `Unexpected recorded requested filename for ${role}.`);
  }
}

export function validateRenderMarker(marker, role) {
  const asset = RENDER_ASSETS[role];
  requireThat(asset !== undefined, "RENDER_ROLE", `Unknown render role '${role}'.`);
  requireThat(record(marker) && marker.schemaVersion === 1, "RENDER_MARKER", `${role} marker schema is invalid.`);
  requireThat(typeof marker.jobId === "string" && marker.jobId.length > 0, "RENDER_MARKER", `${role} marker is missing jobId.`);
  requireThat(marker.status === "DONE" && marker.ok === true && marker.error === null && marker.queueItemRemoved === true,
    "RENDER_MARKER", `${role} marker does not prove a completed successful queue lifecycle.`);
  requireThat(typeof marker.completedAtMs === "number" && Number.isFinite(marker.completedAtMs) && marker.completedAtMs > 0,
    "RENDER_MARKER", `${role} marker completedAtMs is invalid.`);
  requireThat(typeof marker.outputPath === "string" && portableBasename(marker.outputPath) === asset.retained,
    "RENDER_MARKER_OUTPUT", `${role} marker does not bind the requested render to the retained canonical MP4.`);
}

export function validateVideoMetadata(metadata) {
  requireThat(record(metadata) && Array.isArray(metadata.streams) && metadata.streams.length === 1,
    "VIDEO_STREAM_COUNT", "Exactly one video stream is required.");
  const stream = metadata.streams[0];
  requireThat(record(stream) && stream.width === FIXTURE.width && stream.height === FIXTURE.height,
    "VIDEO_DIMENSIONS", "The evidence must retain the original 320 by 320 canvas.");
  const ratio = (text) => {
    if (typeof text !== "string" || !/^\d+\/\d+$/.test(text)) return NaN;
    const [numerator, denominator] = text.split("/").map(Number);
    return denominator > 0 ? numerator / denominator : NaN;
  };
  requireThat(ratio(stream.avg_frame_rate) === FIXTURE.frameRate && ratio(stream.r_frame_rate) === FIXTURE.frameRate,
    "VIDEO_FRAME_RATE", "No retiming or frame-rate conversion is permitted.");
  requireThat(Array.isArray(metadata.frames) && metadata.frames.length === FIXTURE.frameCount,
    "VIDEO_FRAME_COUNT", "Expected all 24 frames, not a trimmed or padded sample.");
  for (let index = 0; index < metadata.frames.length; index += 1) {
    const frame = metadata.frames[index];
    const timestamp = record(frame) ? frame.best_effort_timestamp_time : undefined;
    requireThat(typeof timestamp === "string" && timestamp.trim() !== "" && Number.isFinite(Number(timestamp))
      && Math.abs(Number(timestamp) - index / FIXTURE.frameRate) <= 0.000001,
      "VIDEO_TIMESTAMPS", `Frame ${index} has a missing, duplicated, shifted, or reordered presentation time.`);
    requireThat(frame.width === FIXTURE.width && frame.height === FIXTURE.height,
      "VIDEO_FRAME_DIMENSIONS", `Frame ${index} changed dimensions.`);
  }
}

export function frameDifference(left, right) {
  requireThat(Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === FRAME_BYTES && right.length === FRAME_BYTES,
    "FRAME_BYTES", "Comparison requires two complete RGB24 frames.");
  let total = 0;
  let changedPixels = 0;
  for (let offset = 0; offset < FRAME_BYTES; offset += 3) {
    let maximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      total += delta;
      maximum = Math.max(maximum, delta);
    }
    if (maximum >= THRESHOLDS.channelDelta) changedPixels += 1;
  }
  return { meanAbsoluteDelta: total / FRAME_BYTES, changedPixelFraction: changedPixels / (FIXTURE.width * FIXTURE.height) };
}

export function compareDecodedRenders(decoded) {
  for (const role of Object.keys(RENDER_ASSETS)) {
    requireThat(Buffer.isBuffer(decoded[role]) && decoded[role].length === VIDEO_BYTES,
      "DECODED_LENGTH", `${role} must contain exactly 24 complete RGB24 frames.`);
  }
  const baseline = decoded.baselineRender;
  const eased = decoded.easedRender;
  const frame = (video, index) => video.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES);
  const visiblyDifferent = (delta) => delta.meanAbsoluteDelta >= THRESHOLDS.meanAbsoluteDelta
    && delta.changedPixelFraction >= THRESHOLDS.changedPixelFraction;
  const comparisons = Array.from({ length: FIXTURE.frameCount }, (_, index) => ({
    frame: index,
    timeSeconds: index / FIXTURE.frameRate,
    ...frameDifference(frame(baseline, index), frame(eased, index)),
    baselineSha256: digest(frame(baseline, index)),
    easedSha256: digest(frame(eased, index)),
  }));
  const before = comparisons.filter((item) => item.frame > 0 && item.frame < 12 && visiblyDifferent(item)).map((item) => item.frame);
  const after = comparisons.filter((item) => item.frame > 12 && visiblyDifferent(item)).map((item) => item.frame);
  const checks = {
    baseline_is_not_static: visiblyDifferent(frameDifference(frame(baseline, 0), frame(baseline, 12))),
    first_key_pixels_unchanged: frame(baseline, 0).equals(frame(eased, 0)),
    middle_key_pixels_unchanged: frame(baseline, 12).equals(frame(eased, 12)),
    visible_incoming_ease: before.length >= THRESHOLDS.framesPerSide,
    visible_outgoing_ease: after.length >= THRESHOLDS.framesPerSide,
    exact_restore_all_frames: baseline.equals(decoded.restoredBaselineRender),
    exact_rollback_all_frames: baseline.equals(decoded.postRollbackRender),
  };
  return {
    ok: Object.values(checks).every((value) => value === true), checks, comparisons,
    visibleIncomingFrames: before, visibleOutgoingFrames: after,
    decodedSha256: Object.fromEntries(Object.entries(decoded).map(([role, bytes]) => [role, digest(bytes)])),
    renderedFrameTimesSeconds: comparisons.map((item) => item.timeSeconds),
    unrenderedKeyframeTimesSeconds: [1],
  };
}

async function readBounded(filePath, maximumBytes) {
  const info = await lstat(filePath);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximumBytes,
    "EVIDENCE_FILE", "Evidence must be a nonempty bounded regular file, not a symlink.");
  const bytes = await readFile(filePath);
  requireThat(bytes.length > 0 && bytes.length <= maximumBytes, "EVIDENCE_FILE", "Evidence changed size while reading.");
  return bytes;
}

async function resolveEvidenceFile(root, basename) {
  const filePath = path.join(root, basename);
  const resolved = await realpath(filePath);
  requireThat(path.dirname(resolved) === root, "EVIDENCE_PATH_ESCAPE", `${basename} resolved outside the artifact directory.`);
  // Return the original path so readBounded() can still reject a symlink by lstat.
  return filePath;
}

async function evidencePathExists(filePath) {
  try { await lstat(filePath); return true; }
  catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function runBinary(executable, args, maximumBytes) {
  try {
    const result = await execute(executable, args, {
      encoding: "buffer", timeout: 15000, killSignal: "SIGKILL", maxBuffer: maximumBytes, windowsHide: true, shell: false,
    });
    requireThat(result.stderr.length === 0, "DECODER_DIAGNOSTIC", result.stderr.toString("utf8").slice(0, 1000));
    return result.stdout;
  } catch (error) {
    throw Object.assign(new Error(`MEDIA_TOOL_FAILED: ${path.basename(executable)}: ${String(error.message).slice(0, 1500)}`), { code: "MEDIA_TOOL_FAILED" });
  }
}

export async function decodeEvidenceVideo(filePath, { ffmpeg = "ffmpeg", ffprobe = "ffprobe" } = {}) {
  filePath = path.resolve(filePath);
  const before = await readBounded(filePath, 64 * 1024 * 1024);
  const formatWhitelist = "avi,mov,mp4,m4a,3gp,3g2,mj2";
  const metadataBytes = await runBinary(ffprobe, [
    "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", formatWhitelist, "-select_streams", "v",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,pix_fmt:frame=best_effort_timestamp_time,width,height",
    "-show_frames", "-of", "json", filePath,
  ], 256 * 1024);
  const metadata = parseJson(metadataBytes);
  validateVideoMetadata(metadata);
  const pixels = await runBinary(ffmpeg, [
    "-v", "error", "-xerror", "-nostdin", "-noautorotate", "-protocol_whitelist", "file", "-format_whitelist", formatWhitelist,
    "-i", filePath, "-map", "0:v:0", "-an", "-sn", "-dn", "-fps_mode", "passthrough",
    "-threads", "1", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], VIDEO_BYTES + 1);
  requireThat(pixels.length === VIDEO_BYTES, "DECODED_LENGTH", "Decoder returned an incomplete or overlong stream.");
  const after = await readBounded(filePath, 64 * 1024 * 1024);
  requireThat(digest(before) === digest(after), "EVIDENCE_CHANGED", "Render changed while being inspected.");
  return { pixels, metadata, encodedSha256: digest(before), encodedBytes: before.length };
}

export async function reviewEvidence({ proofPath, acceptedP1P2Path, artifactDir = path.dirname(proofPath), ffmpeg, ffprobe }) {
  const proofBytes = await readBounded(proofPath, 2 * 1024 * 1024);
  const dependencyBytes = await readBounded(acceptedP1P2Path, 2 * 1024 * 1024);
  const proof = parseJson(proofBytes);
  validateEvidenceRecord(proof, parseJson(dependencyBytes), dependencyBytes);
  const root = await realpath(artifactDir);
  const decoded = {};
  const artifacts = {};
  for (const [role, asset] of Object.entries(RENDER_ASSETS)) {
    const markerCandidate = path.join(root, asset.marker);
    const retainedCandidate = path.join(root, asset.retained);
    const markerPresent = await evidencePathExists(markerCandidate);
    const retainedPresent = await evidencePathExists(retainedCandidate);
    let filePath;
    let marker = null;
    let markerSha256 = null;
    let retainedFilename = asset.requested;

    // Production render.capture can canonicalize the requested .avi path to a
    // retained .mp4. If either canonical artifact is present, require the pair
    // and bind them through the completion marker instead of silently falling
    // back to another file. Synthetic/legacy verifier fixtures may still use
    // the originally requested AVI when neither canonical artifact is present.
    if (markerPresent || retainedPresent) {
      requireThat(markerPresent && retainedPresent, "RENDER_CANONICAL_PAIR", `${role} canonical render and completion marker must be retained together.`);
      const markerPath = await resolveEvidenceFile(root, asset.marker);
      const markerBytes = await readBounded(markerPath, 64 * 1024);
      marker = parseJson(markerBytes);
      validateRenderMarker(marker, role);
      markerSha256 = digest(markerBytes);
      filePath = await resolveEvidenceFile(root, asset.retained);
      retainedFilename = asset.retained;
    } else {
      filePath = await resolveEvidenceFile(root, asset.requested);
    }

    const result = await decodeEvidenceVideo(filePath, { ffmpeg, ffprobe });
    decoded[role] = result.pixels;
    artifacts[role] = {
      requestedFilename: asset.requested,
      retainedFilename,
      markerFilename: marker === null ? null : asset.marker,
      markerSha256,
      marker,
      encodedSha256: result.encodedSha256,
      encodedBytes: result.encodedBytes,
      metadata: result.metadata,
    };
  }
  const review = compareDecodedRenders(decoded);
  return {
    schemaVersion: 1,
    verifier: "M3_TEMPORAL_EASE_P3_P4_PIXEL_SCREEN_V2",
    status: review.ok ? "PIXEL_CHECKS_PASSED_REVIEW_REQUIRED" : "PIXEL_CHECKS_FAILED",
    ...review,
    P3_visual_proof: false, P5_save_reopen_reconnect_transfer: false, independentReviewRequired: true,
    evidenceKind: proof.evidenceKind ?? "AS_DECLARED_BY_INPUT_RECORD_NOT_AUTHENTICATED",
    proofRecordSha256: digest(proofBytes), acceptedP1P2Sha256: digest(dependencyBytes),
    fixture: FIXTURE, thresholds: THRESHOLDS, artifacts,
    limitations: [
      "Numeric screening does not authenticate GitHub provenance or accept real-AE proof maturity.",
      "Independent review of retained frames and structural provenance is still required.",
      "The key at 1 second is outside this 24-frame render; no visual claim is made for that endpoint.",
      "Full-frame RGB24 equivalence is bounded to this opaque fixture, not arbitrary alpha or higher-bit-depth edits.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {};
    const names = { "--proof": "proofPath", "--accepted-p1-p2": "acceptedP1P2Path", "--artifact-dir": "artifactDir", "--ffmpeg": "ffmpeg", "--ffprobe": "ffprobe" };
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = names[process.argv[index]];
      const value = process.argv[index + 1];
      requireThat(name && value && !value.startsWith("--") && options[name] === undefined, "CLI_ARGUMENTS", "Unknown, duplicate, or incomplete argument.");
      options[name] = value;
    }
    requireThat(options.proofPath && options.acceptedP1P2Path, "CLI_ARGUMENTS", "--proof and --accepted-p1-p2 are required.");
    const result = await reviewEvidence(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "PIXEL_CHECKS_FAILED", ok: false, code: error.code ?? "INVALID_EVIDENCE", error: error.message, P3_visual_proof: false, independentReviewRequired: true }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
