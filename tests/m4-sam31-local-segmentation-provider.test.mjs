import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SAM31_LOCAL_PROVIDER_ID,
  SAM31_LOCAL_SIDECAR_SCHEMA,
  Sam31LocalSegmentationProviderV1,
  Sam31SegmentationProviderError,
} from "../.tmp/runtime/packages/adapters/sam3-local/src/index.js";

const request = {
  requestId: "SEG_REQ_1",
  sourceId: "SOURCE_1",
  timestampMs: 1250,
  semanticId: "PERSON_PRIMARY",
  entityClass: "person",
  prompt: { boundingBox: [0.1, 0.2, 0.4, 0.6] },
  preferredEncoding: "ALPHA",
};

const source = {
  sourceId: "SOURCE_1",
  absolutePath: "C:\\Media\\shot.mp4",
  contentType: "video/mp4",
  evidenceIds: ["SOURCE_PROOF_1"],
};
const config = (sourceResolver) => ({
  executablePath: "C:\\SAM31\\python.exe",
  scriptPath: "C:\\EditFlow\\sam31_segmentation_provider.py",
  workingDirectory: "C:\\EditFlow",
  artifactDirectory: "C:\\EditFlow\\proofs\\sam31",
  sourceResolver,
  timeoutMs: 90000,
  confidenceThreshold: 0.55,
});

const processResult = (stdout, extra = {}) => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  timedOut: false,
  ...extra,
});

const validResult = () => ({
  requestId: request.requestId,
  sourceId: request.sourceId,
  timestampMs: request.timestampMs,
  semanticId: request.semanticId,
  entityClass: request.entityClass,
  providerId: SAM31_LOCAL_PROVIDER_ID,
  providerVersion: "sam3-0.1.0",
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: {
      artifactId: "sam31:SEG_REQ_1:abcdef",
      contentType: "image/png",
      sha256: "a".repeat(64),
    },
  },
  confidence: 0.91,
  edgeQuality: 0.82,
  temporalConsistency: 0,
  occlusion: 0.09,
  evidenceIds: ["SOURCE_PROOF_1", "SAM31_MODEL:facebook/sam3"],
});

const resolver = {
  async resolve(value) {
    assert.equal(value.sourceId, source.sourceId);
    return source;
  },
};
test("SAM 3.1 local provider resolves exact source identity and accepts only correlated output", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({ status: "COMPLETED", result: validResult() }));
  } };
  const provider = new Sam31LocalSegmentationProviderV1(config(resolver), runner);
  const result = await provider.segment(request);
  assert.equal(result.providerId, SAM31_LOCAL_PROVIDER_ID);
  assert.equal(result.mask.artifact.artifactId, "sam31:SEG_REQ_1:abcdef");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), [config(resolver).scriptPath, "--request-json"]);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, SAM31_LOCAL_SIDECAR_SCHEMA);
  assert.equal(payload.request.semanticId, request.semanticId);
  assert.equal(payload.source.sourceId, request.sourceId);
  assert.equal(payload.source.absolutePath, source.absolutePath);
  assert.deepEqual(payload.source.evidenceIds, ["SOURCE_PROOF_1"]);
  assert.equal(payload.confidenceThreshold, 0.55);
});
test("provider fails closed before launch on unsupported point prompts or missing subject prompt", async () => {
  let calls = 0;
  const provider = new Sam31LocalSegmentationProviderV1(config(resolver), { async run() { calls += 1; return processResult(""); } });
  await assert.rejects(
    provider.segment({ ...request, prompt: { ...request.prompt, positivePoints: [{ x: 0.2, y: 0.3 }] } }),
    (error) => error instanceof Sam31SegmentationProviderError && error.code === "POINT_PROMPTS_UNSUPPORTED",
  );
  await assert.rejects(
    provider.segment({ requestId: "R2", sourceId: "SOURCE_1", timestampMs: 0, semanticId: "SUBJECT" }),
    (error) => error instanceof Sam31SegmentationProviderError && error.code === "SUBJECT_PROMPT_REQUIRED",
  );
  assert.equal(calls, 0);
});

test("provider requires exact previous-artifact resolution for temporal refinement", async () => {
  const provider = new Sam31LocalSegmentationProviderV1(config(resolver), { async run() { throw new Error("must not launch"); } });
  await assert.rejects(
    provider.segment({ ...request, prompt: { ...request.prompt, previousArtifactId: "PRIOR_MASK" } }),
    (error) => error instanceof Sam31SegmentationProviderError && error.code === "PREVIOUS_ARTIFACT_RESOLUTION_FAILED",
  );
});
test("provider preserves semantic refusal codes and rejects invalid sidecar correlation", async () => {
  const gated = new Sam31LocalSegmentationProviderV1(config(resolver), {
    async run() { return processResult(JSON.stringify({ status: "REFUSED", code: "CHECKPOINT_ACCESS_REQUIRED", detail: "HF gate" })); },
  });
  await assert.rejects(
    gated.segment(request),
    (error) => error instanceof Sam31SegmentationProviderError && error.code === "CHECKPOINT_ACCESS_REQUIRED",
  );

  const bad = validResult();
  bad.semanticId = "OTHER_SUBJECT";
  const mismatched = new Sam31LocalSegmentationProviderV1(config(resolver), {
    async run() { return processResult(JSON.stringify({ status: "COMPLETED", result: bad })); },
  });
  await assert.rejects(
    mismatched.segment(request),
    (error) => error instanceof Sam31SegmentationProviderError && error.code === "INVALID_SEGMENTATION_RESULT",
  );
});
test("local SAM 3.1 sidecar is fixed-model, fail-closed, and retains exact artifact provenance", async () => {
  const ts = await readFile("packages/adapters/sam3-local/src/index.ts", "utf8");
  const py = await readFile("packages/adapters/sam3-local/runtime/sam31_segmentation_provider.py", "utf8");
  assert.match(ts, /shell:\s*false/);
  assert.match(ts, /SOURCE_PROVENANCE_MISSING/);
  assert.match(ts, /PREVIOUS_ARTIFACT_RESOLUTION_FAILED/);
  assert.doesNotMatch(ts, /cmd\.exe|Invoke-Expression/);
  assert.match(py, /build_sam3_image_model/);
  assert.match(py, /Sam3Processor/);
  assert.match(py, /CHECKPOINT_ACCESS_REQUIRED/);
  assert.match(py, /len\(scores\) != 1/);
  assert.match(py, /previous segmentation artifact identity was not resolved exactly/);
  assert.match(py, /SAM31_OCCLUSION:PRESENCE_SCORE_PROXY/);
  assert.doesNotMatch(py, /C:\\Users\\Shadow/);
});
