import test from "node:test";
import assert from "node:assert/strict";
import { resolveSemanticAttachPointV1 } from "../.tmp/runtime/packages/tracking-state/src/semantic-attach.js";

const face = {
  semanticId: "FACE_PETER_01",
  entityClass: "FACE",
  boundingBox: [0.2, 0.1, 0.4, 0.5],
  confidence: 0.94,
  landmarks: { nose_tip: { x: 0.4, y: 0.3, confidence: 0.9 } },
};

test("unknown bounding-box anchor fails closed for untyped runtime callers", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "BOUNDING_BOX", anchor: "CHEST" },
  }), null);
});

test("unknown target kind fails closed for untyped runtime callers", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "GUESS", anchor: "CENTER" },
  }), null);
});

test("non-string landmark name fails closed instead of throwing", () => {
  assert.equal(resolveSemanticAttachPointV1([face], {
    semanticId: face.semanticId,
    target: { kind: "LANDMARK", landmark: 42 },
  }), null);
});
