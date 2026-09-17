import test from "node:test";
import assert from "node:assert/strict";

import {
  learnFromTutorialUploadV0,
  TutorialLessonValidationError,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";

const upload = {
  uploadId: "upload-001",
  mediaRef: "upload://tutorial-001.mp4",
  transcriptRef: "upload://tutorial-001.txt",
};

const makePacket = (sourceRef = upload.mediaRef) => ({
  tutorialId: "tutorial-001",
  title: "Opacity pulse tutorial",
  sourceRef,
  durationMs: 5000,
  evidenceRefs: ["frame:90"],
  skills: [{
    skillId: "skill.opacity-pulse",
    name: "Opacity pulse",
    objective: "Create a brief opacity accent.",
    whenToUse: "A short visual accent supports the edit.",
    adaptationVariables: ["opacity", "duration"],
    validationCriteria: ["accent remains readable"],
    steps: [{
      stepId: "step-opacity",
      startMs: 1000,
      endMs: 1300,
      intent: "Create the accent.",
      action: "Animate opacity.",
      observableResult: "The layer briefly fades and returns.",
      capabilityRequirements: [{
        capabilityId: "ae.keyframe.set",
        reason: "Create opacity keyframes.",
        minimumProofMaturity: "STRUCTURAL",
      }],
    }],
  }],
});

const registry = () => {
  const value = new CapabilityRegistry("env:tutorial-upload", "2026-09-17T20:10:00.000Z");
  value.registerStatic([]);
  return value;
};
test("tutorial upload flows through analyzer, lesson compiler, and capability discovery", async () => {
  let observedUpload = null;
  const analyzer = { analyze: async (value) => { observedUpload = value; return makePacket(); } };
  const result = await learnFromTutorialUploadV0(upload, analyzer, registry(), "2026-09-17T20:11:00.000Z");
  assert.equal(observedUpload, upload);
  assert.equal(result.lesson.tutorialId, "tutorial-001");
  assert.equal(result.lesson.skills[0].learningState, "OBSERVED");
  assert.equal(result.capabilityReport.findings[0].state, "UNREGISTERED");
  assert.equal(result.capabilityReport.developmentQueue[0].kind, "REGISTER_CAPABILITY");
});

test("tutorial upload rejects analyzer output that loses source lineage", async () => {
  const analyzer = { analyze: async () => makePacket("upload://different.mp4") };
  await assert.rejects(
    () => learnFromTutorialUploadV0(upload, analyzer, registry()),
    TutorialLessonValidationError,
  );
});
