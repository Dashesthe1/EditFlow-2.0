import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hostPath = "scripts/windows/tutorial-001-short-motion.jsx";
const runnerPath = "scripts/proofs/tutorial-001-live-structural.mjs";
const profilePath = "scripts/proofs/tutorial-001-motion-profile.mjs";

test("Tutorial 001 short-motion fixture is bounded and captures only declared landmark frames", async () => {
  const [host, profile] = await Promise.all([
    readFile(hostPath, "utf8"),
    readFile(profilePath, "utf8"),
  ]);
  assert.match(host, /M5_TUTORIAL_001_SHORT_MOTION_V1/);
  assert.match(host, /REF_LEFT/);
  assert.match(host, /REF_RIGHT/);
  assert.match(host, /MOTION/);
  assert.match(host, /1600, 1700, 1800, 1900, 2100, 2200, 2300, 2400/);
  assert.doesNotMatch(host, /renderQueue\.render\s*\(/);
  assert.doesNotMatch(host, /app\.quit\s*\(/);
  assert.match(profile, /expectedTrend: "ACCELERATE"/);
  assert.match(profile, /expectedTrend: "DECELERATE"/);
});

test("Tutorial 001 live runner exposes Level-4 motion as an explicit independent gate", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /EDITFLOW_T001_MOTION === "1"/);
  assert.match(source, /m5-tutorial-001-live-adaptive-short-motion\.json/);
  assert.match(source, /evaluateMotionLandmarkProofV1/);
  assert.match(source, /TUTORIAL_001_MOTION_SEGMENTS/);
  assert.match(source, /assessment\.passed/);
  assert.match(source, /visual and motion proof modes must run independently/);
  assert.match(source, /baselineFingerprintRestored/);
});
