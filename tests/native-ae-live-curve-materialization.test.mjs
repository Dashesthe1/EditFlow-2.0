import test from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
  NativeAeCurveMaterializationError,
  materializeCameraPushV1,
  materializeTimeRemapPulseV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/native-curve-materialization.js";

const timeIntent = (velocityContrast = 0.4) => ({
  schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
  kind: "TIME_REMAP_PULSE",
  keyTimesSeconds: [1, 1.5, 2],
  velocityContrast,
});

test("live Time Remap materialization derives source values from the native baseline", () => {
  const first = materializeTimeRemapPulseV1(timeIntent(), {
    timeRemapEnabled: true,
    propertyAvailable: true,
    keys: [
      { index: 1, time: 0, value: 0 },
      { index: 2, time: 3, value: 3 },
    ],
  });
  const second = materializeTimeRemapPulseV1(timeIntent(), {
    timeRemapEnabled: true,
    propertyAvailable: true,
    keys: [
      { index: 1, time: 0, value: 0 },
      { index: 2, time: 3, value: 6 },
    ],
  });
  assert.deepEqual(
    first.keyframes.map((keyframe) => keyframe.value),
    [1, 1.5, 2],
  );
  assert.deepEqual(
    second.keyframes.map((keyframe) => keyframe.value),
    [2, 3, 4],
  );
  assert.notDeepEqual(first.keyframes, second.keyframes);
  assert.ok(first.easeIntentByKey[0].inEase.speed < first.easeIntentByKey[1].inEase.speed);
  assert.ok(first.easeIntentByKey[1].inEase.speed > first.easeIntentByKey[2].inEase.speed);
  assert.equal(first.easeIntentByKey[0].inEase.speed, first.easeIntentByKey[2].inEase.speed);
  assert.ok(first.easeIntentByKey[1].inEase.influence > first.easeIntentByKey[0].inEase.influence);
});

test("live Time Remap pulse preserves baseline source samples and concentrates playback rate at the anchor", () => {
  for (const baselineRate of [0.5, 1, 2]) {
    for (const velocityContrast of [0, 0.2, 0.5, 0.79]) {
      const curve = materializeTimeRemapPulseV1(timeIntent(velocityContrast), {
        timeRemapEnabled: true,
        propertyAvailable: true,
        keys: [
          { index: 1, time: 0, value: 0 },
          { index: 2, time: 3, value: 3 * baselineRate },
        ],
      });
      assert.deepEqual(
        curve.keyframes.map((keyframe) => keyframe.value),
        [baselineRate, 1.5 * baselineRate, 2 * baselineRate],
      );
      const speeds = curve.easeIntentByKey.map((entry) => entry.inEase.speed);
      assert.ok(speeds.every((speed) => speed > 0));
      assert.equal(speeds[0], speeds[2]);
      if (velocityContrast === 0) {
        assert.deepEqual(speeds, [baselineRate, baselineRate, baselineRate]);
      } else {
        assert.ok(speeds[1] > baselineRate);
        assert.ok(speeds[0] < baselineRate);
      }
    }
  }
});

test("live Time Remap materialization fails closed on a pre-authored custom curve", () => {
  assert.throws(
    () => materializeTimeRemapPulseV1(timeIntent(), {
      timeRemapEnabled: true,
      propertyAvailable: true,
      keys: [
        { index: 1, time: 0, value: 0 },
        { index: 2, time: 1.5, value: 1.2 },
        { index: 3, time: 3, value: 3 },
      ],
    }),
    (error) => error instanceof NativeAeCurveMaterializationError
      && error.code === "PREAUTHORED_TIME_REMAP_REQUIRES_POLICY",
  );
});

const cameraIntent = (component) => ({
  schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
  kind: "CAMERA_PUSH",
  component,
  keyTimesSeconds: [1.8, 2, 2.2],
  zoomIntensity: 0.3,
  zoomCenter: [0.62, 0.44],
});
test("camera push materialization preserves the selected subject point across live transforms", () => {
  const baseline = {
    anchorPoint: [100, 200],
    position: [500, 600],
    scale: [80, 120],
    compWidth: 1080,
    compHeight: 1920,
  };
  const scale = materializeCameraPushV1(cameraIntent("SCALE"), baseline);
  const position = materializeCameraPushV1(cameraIntent("POSITION"), baseline);

  assert.deepEqual(scale.keyframes[0].value, [80, 120]);
  assert.deepEqual(scale.keyframes[1].value, [104, 156]);
  assert.deepEqual(scale.keyframes[2].value, [80, 120]);

  const subjectPoint = [0.62 * 1080, 0.44 * 1920];
  const expectedPeakPosition = baseline.position.map((component, index) => {
    const baselineScaleFactor = baseline.scale[index] / 100;
    const sourceOffset = (subjectPoint[index] - baseline.anchorPoint[index])
      * baselineScaleFactor;
    return component + (1 - 1.3) * sourceOffset;
  });
  assert.deepEqual(position.keyframes[0].value, baseline.position);
  assert.deepEqual(position.keyframes[1].value, expectedPeakPosition);
  assert.deepEqual(position.keyframes[2].value, baseline.position);
  assert.equal(position.easeIntentByKey.length, 3);
});
