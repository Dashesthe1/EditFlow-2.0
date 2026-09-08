// Synthetic verifier fixtures only. These are not After Effects proof evidence.
import { createHash } from "node:crypto";
import { FIXTURE, RENDERS } from "../../scripts/proofs/verify-temporal-ease-visual.mjs";

export function syntheticVideo(eased = false) {
  const pixels = FIXTURE.width * FIXTURE.height;
  const bytes = Buffer.alloc(pixels * 3 * FIXTURE.frameCount);
  for (let frame = 0; frame < FIXTURE.frameCount; frame += 1) {
    const linear = frame <= 12 ? frame / 12 : (24 - frame) / 12;
    const weight = eased ? 1 - (1 - linear) ** 3 : linear;
    const rgb = [220, 48, 48].map((value, channel) => Math.round(value + ([36, 90, 232][channel] - value) * weight));
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const offset = (frame * pixels + pixel) * 3;
      for (let channel = 0; channel < 3; channel += 1) bytes[offset + channel] = rgb[channel];
    }
  }
  return bytes;
}

export function syntheticDecoded() {
  const baseline = syntheticVideo();
  return { baselineRender: baseline, easedRender: syntheticVideo(true), restoredBaselineRender: baseline, postRollbackRender: baseline };
}

export function syntheticMetadata() {
  return {
    streams: [{ width: 320, height: 320, avg_frame_rate: "24/1", r_frame_rate: "24/1", pix_fmt: "bgr24" }],
    frames: Array.from({ length: 24 }, (_, index) => ({ best_effort_timestamp_time: (index / 24).toFixed(6), width: 320, height: 320 })),
  };
}

export function syntheticRecords() {
  const dependency = {
    schemaVersion: 1, proof: "M3_TEMPORAL_EASE_P1_P2_REAL_AE", protocolVersion: "1.8.0", ok: true, cleanupComplete: true,
    evidenceKind: "SYNTHETIC_VERIFIER_TEST_NOT_AE",
    proofLevels: { P1_validation_rejection: true, P2_structural_readback: true, P3_visual_proof: false, P4_failure_injection_rollback: false, P5_save_reopen_reconnect_transfer: false },
  };
  const dependencyBytes = Buffer.from(JSON.stringify(dependency));
  const proof = {
    proofId: "M3_TEMPORAL_EASE_P3_P4_REAL_AE", status: "VISUAL_REVIEW_REQUIRED", ok: true, visualReviewRequired: true,
    evidenceKind: "SYNTHETIC_VERIFIER_TEST_NOT_AE", cleanupComplete: true, cleanupErrors: [], failureError: null,
    acceptedP1P2: { sha256: createHash("sha256").update(dependencyBytes).digest("hex") },
    proofLevels: { P1_validation_rejection: true, P2_structural_readback: true, P3_visual_artifact_emitted: true, P3_visual_proof: false, P4_failure_injection_rollback: true, P5_save_reopen_reconnect_transfer: false },
    fixture: { keyIndex: 2, propertyPath: ["ADBE Transform Group", "ADBE Opacity"], keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 100 }, { time: 1, value: 0 }] },
    visualReviewSpec: Object.fromEntries(Object.entries(RENDERS).map(([role, basename]) => [role, `C:\\runner\\proofs\\${basename}`])),
  };
  return { proof, dependency, dependencyBytes };
}
