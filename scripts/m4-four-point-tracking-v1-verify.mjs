import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fourPointTrackerReadbackToPerspectiveTrackV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-four-point-tracking.js";

const root = resolve(process.cwd());
const inputPath = resolve(root, "proofs/artifacts/m4-four-point-tracking-v1-live.json");
const outputPath = resolve(root, "proofs/artifacts/m4-four-point-tracking-v1-runtime-verify.json");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const mapping = { upperLeftIndex: 1, upperRightIndex: 2, lowerLeftIndex: 3, lowerRightIndex: 4 };
const checks = {};

const near = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;
const nearPair = (a, b, epsilon = 1e-6) => !!a && !!b && near(a[0], b[0], epsilon) && near(a[1], b[1], epsilon);
const project = (h, point) => {
  const [x, y] = point;
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};

checks.liveFixturePassed = input?.ok === true;
const readback = input?.response?.readback ?? null;
const track = readback ? fourPointTrackerReadbackToPerspectiveTrackV1(readback, mapping, 1) : null;
checks.converterAcceptedRealAeReadback = !!track;
checks.twoSynchronizedSamples = track?.samples.length === 2;
checks.baselineAreaExact = near(track?.baselineAreaPx ?? Number.NaN, 360000);
checks.baselineIdentityHomography = !!track && track.samples[0].homography.every((value, index) => near(value, [1, 0, 0, 0, 1, 0, 0, 0, 1][index], 1e-8));

const expectedFinal = input?.geometry?.destinationCompCorners ?? [];
const finalSample = track?.samples[1] ?? null;
const semanticBaseline = track ? [
  track.baselineCornersPx.upperLeft,
  track.baselineCornersPx.upperRight,
  track.baselineCornersPx.lowerLeft,
  track.baselineCornersPx.lowerRight,
] : [];
checks.finalCornersMatchProtocolReadback = !!finalSample && [
  finalSample.cornersNormalized.upperLeft,
  finalSample.cornersNormalized.upperRight,
  finalSample.cornersNormalized.lowerLeft,
  finalSample.cornersNormalized.lowerRight,
].every((point, index) => nearPair([point[0] * readback.comp.width, point[1] * readback.comp.height], expectedFinal[index], 1e-6));
checks.homographyReprojectsAllFourCorners = !!finalSample && semanticBaseline.every((point, index) => nearPair(project(finalSample.homography, point), expectedFinal[index], 1e-5));
checks.projectiveDenominatorIsNonAffine = !!finalSample && (Math.abs(finalSample.homography[6]) > 1e-9 || Math.abs(finalSample.homography[7]) > 1e-9);
checks.confidenceUsesWeakestNativePoint = !!finalSample && near(finalSample.confidence, 0.91, 1e-9);

const ok = Object.values(checks).every(Boolean);
const result = {
  proof: "M4_FOUR_POINT_TRACKING_V1_RUNTIME_VERIFY",
  ok,
  checks,
  mapping,
  track: track ? {
    baselineTime: track.baselineTime,
    baselineAreaPx: track.baselineAreaPx,
    baselineCornersPx: track.baselineCornersPx,
    finalCornersNormalized: finalSample?.cornersNormalized ?? null,
    finalQuadAreaNormalized: finalSample?.quadAreaNormalized ?? null,
    finalHomography: finalSample?.homography ?? null,
    finalConfidence: finalSample?.confidence ?? null,
  } : null,
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
if (!ok) process.exitCode = 1;
