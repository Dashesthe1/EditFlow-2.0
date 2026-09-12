import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSemanticAttachPointV1,
} from "../.tmp/runtime/packages/tracking-state/src/semantic-attach.js";
import {
  M4_SEMANTIC_ATTACH_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-semantic-attach.js";

const face = {
  semanticId: "FACE_PETER_01",
  entityClass: "FACE",
  boundingBox: [0.2, 0.1, 0.4, 0.5],
  confidence: 0.94,
  evidenceIds: ["SCENE:FRAME_120:FACE_01"],
  landmarks: {
    nose_tip: {
      x: 0.41,
      y: 0.31,
      confidence: 0.91,
      evidenceIds: ["POSE:FRAME_120:NOSE_TIP"],
    },
    left_eye: {
      x: 0.34,
      y: 0.24,
      confidence: 0.89,
    },
  },
};

const secondFace = {
  semanticId: "FACE_GWEN_01",
  entityClass: "FACE",
  boundingBox: [0.65, 0.15, 0.2, 0.3],
  confidence: 0.9,
  evidenceIds: ["SCENE:FRAME_120:FACE_02"],
};

const assertPointClose = (actual, expected, epsilon = 1e-12) => {
  assert.ok(actual);
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= epsilon,
      `coordinate ${index}: expected ${expected[index]}, got ${actual[index]}`);
  }
};

test("semantic attach capability is declared, read-only, and not falsely runtime-proven", () => {
  assert.equal(M4_SEMANTIC_ATTACH_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_SEMANTIC_ATTACH_CAPABILITY_V1.proofMaturity, "DECLARED");
  assert.equal(M4_SEMANTIC_ATTACH_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_SEMANTIC_ATTACH_CAPABILITY_V1.routes[0].kind, "SUBSYSTEM_ADAPTER");
  assert.ok(M4_SEMANTIC_ATTACH_CAPABILITY_V1.limitations.some((value) => value.includes("Runtime capability registration is intentionally withheld")));
});

test("exact semanticId resolves the entity bounding-box center deterministically", () => {
  const result = resolveSemanticAttachPointV1([face, secondFace], {
    semanticId: "FACE_PETER_01",
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  });
  assert.ok(result);
  assert.equal(result.semanticId, "FACE_PETER_01");
  assert.equal(result.source, "BOUNDING_BOX");
  assert.equal(result.anchor, "CENTER");
  assertPointClose(result.pointNormalized, [0.4, 0.35]);
  assert.equal(result.pointCompPx, null);
  assert.equal(result.confidence, 0.94);
  assert.deepEqual(result.evidenceIds, ["SCENE:FRAME_120:FACE_01"]);
});

test("all bounding-box anchor geometries are derived without inventing landmarks", () => {
  const expected = new Map([
    ["TOP", [0.4, 0.1]],
    ["BOTTOM", [0.4, 0.6]],
    ["LEFT", [0.2, 0.35]],
    ["RIGHT", [0.6, 0.35]],
    ["TOP_LEFT", [0.2, 0.1]],
    ["TOP_RIGHT", [0.6, 0.1]],
    ["BOTTOM_LEFT", [0.2, 0.6]],
    ["BOTTOM_RIGHT", [0.6, 0.6]],
  ]);
  for (const [anchor, point] of expected) {
    const result = resolveSemanticAttachPointV1([face], {
      semanticId: face.semanticId,
      target: { kind: "BOUNDING_BOX", anchor },
    });
    assert.ok(result);
    assertPointClose(result.pointNormalized, point);
    assert.equal(result.landmark, null);
  }
});

test("optional comp extent converts normalized attach geometry into composition pixels", () => {
  const result = resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
    compWidth: 1920,
    compHeight: 1080,
  });
  assert.ok(result);
  assertPointClose(result.pointCompPx, [768, 378]);
});

test("named landmark requires exact upstream evidence and merges provenance", () => {
  const result = resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "LANDMARK", landmark: "nose_tip" },
    compWidth: 1000,
    compHeight: 500,
  });
  assert.ok(result);
  assert.equal(result.source, "LANDMARK");
  assert.equal(result.anchor, null);
  assert.equal(result.landmark, "nose_tip");
  assertPointClose(result.pointNormalized, [0.41, 0.31]);
  assertPointClose(result.pointCompPx, [410, 155]);
  assert.equal(result.confidence, 0.91);
  assert.deepEqual(result.evidenceIds, ["SCENE:FRAME_120:FACE_01", "POSE:FRAME_120:NOSE_TIP"]);

  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "LANDMARK", landmark: "left_hand" },
  }), null);
});

test("class-only selection fails closed when more than one entity matches", () => {
  assert.equal(resolveSemanticAttachPointV1([face, secondFace], {
    entityClass: "FACE",
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  }), null);

  const unique = resolveSemanticAttachPointV1([face, secondFace], {
    entityClass: "FACE",
    semanticId: "FACE_GWEN_01",
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  });
  assert.ok(unique);
  assert.equal(unique.semanticId, "FACE_GWEN_01");
});

test("confidence floor applies to both entity and landmark evidence", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    minConfidence: 0.95,
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  }), null);

  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    minConfidence: 0.92,
    target: { kind: "LANDMARK", landmark: "nose_tip" },
  }), null);
});

test("invalid or out-of-frame bounding boxes are rejected", () => {
  const invalid = [
    { ...face, semanticId: "BAD_NEG", boundingBox: [-0.1, 0.2, 0.3, 0.3] },
    { ...face, semanticId: "BAD_ZERO", boundingBox: [0.1, 0.2, 0, 0.3] },
    { ...face, semanticId: "BAD_RIGHT", boundingBox: [0.9, 0.2, 0.2, 0.3] },
    { ...face, semanticId: "BAD_BOTTOM", boundingBox: [0.2, 0.9, 0.3, 0.2] },
  ];
  for (const entity of invalid) {
    assert.equal(resolveSemanticAttachPointV1([entity], {
      semanticId: entity.semanticId,
      target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
    }), null);
  }
});

test("invalid comp extent, selector, threshold, or landmark geometry fails closed", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
    compWidth: 1920,
  }), null);
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
    compWidth: 0,
    compHeight: 1080,
  }), null);
  assert.equal(resolveSemanticAttachPointV1([face], {
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  }), null);
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    minConfidence: 1.1,
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  }), null);

  const malformedLandmark = {
    ...face,
    semanticId: "FACE_BAD_LANDMARK",
    landmarks: { wrist: { x: Number.NaN, y: 0.4, confidence: 0.9 } },
  };
  assert.equal(resolveSemanticAttachPointV1([malformedLandmark], {
    semanticId: malformedLandmark.semanticId,
    target: { kind: "LANDMARK", landmark: "wrist" },
  }), null);
});

test("entity class constraint must agree with exact semantic identity", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    entityClass: "PERSON",
    target: { kind: "BOUNDING_BOX", anchor: "CENTER" },
  }), null);
});
