import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SAM31_LOCAL_PROVIDER_ID,
  SAM31_LOCAL_SIDECAR_SCHEMA,
  Sam31LocalSegmentationProviderV1,
} from "../.tmp/runtime/packages/adapters/sam3-local/src/index.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const providerErrorCode = (code) => (error) => error?.name === "Sam31SegmentationProviderError" && error?.code === code;

const makeFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-sam31-"));
  const artifactDirectory = path.join(root, "artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const sourcePath = path.join(root, "source.png");
  await writeFile(sourcePath, Buffer.from("source-bytes"));
  const artifactPath = path.join(artifactDirectory, "mask.png");
  const artifactBytes = Buffer.from("verified-mask-bytes");
  await writeFile(artifactPath, artifactBytes);
  const request = {
    requestId: "SEG_SAM31_001",
    sourceId: "MEDIA_001",
    timestampMs: 1250,
    semanticId: "PERSON_PETER_01",
    entityClass: "PERSON",
    preferredEncoding: "ALPHA",
    prompt: { boundingBox: [0.2, 0.1, 0.4, 0.7] },
  };
  const result = {
    requestId: request.requestId,
    sourceId: request.sourceId,
    timestampMs: request.timestampMs,
    semanticId: request.semanticId,
    entityClass: request.entityClass,
    providerId: SAM31_LOCAL_PROVIDER_ID,
    providerVersion: "sam3.1:code-0.1.0",
    mask: {
      encoding: "ALPHA",
      width: 1920,
      height: 1080,
      boundsNormalized: [0, 0, 1, 1],
      artifact: {
        artifactId: "sam31:SEG_SAM31_001:verified",
        contentType: "image/png",
        sha256: sha256(artifactBytes),
      },
    },
    confidence: 0.94,
    edgeQuality: 0.89,
    temporalConsistency: 0,
    occlusion: 0.06,
    evidenceIds: ["SOURCE:FRAME_1250", "SAM31_MODEL:facebook/sam3.1"],
  };
  const sourceResolver = {
    async resolve() {
      return {
        sourceId: request.sourceId,
        absolutePath: sourcePath,
        contentType: "image/png",
        evidenceIds: ["SOURCE:FRAME_1250", "SOURCE:FRAME_1250"],
      };
    },
  };
  const config = {
    executablePath: process.execPath,
    scriptPath: path.join(root, "sam31_segmentation_provider.py"),
    workingDirectory: root,
    artifactDirectory,
    sourceResolver,
    timeoutMs: 3000,
    confidenceThreshold: 0.55,
  };
  return { root, artifactDirectory, sourcePath, artifactPath, artifactBytes, request, result, config };
};

const completed = (fixture, overrides = {}) => JSON.stringify({
  status: "COMPLETED",
  artifactPath: fixture.artifactPath,
  result: { ...fixture.result, ...overrides },
});

const processResult = (stdout, overrides = {}) => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  timedOut: false,
  ...overrides,
});

test("SAM 3.1 local provider sends one fixed sidecar request and retains only a hash-verified artifact", async () => {
  const fixture = await makeFixture();
  const calls = [];
  const runner = {
    async run(input) {
      calls.push(input);
      return processResult(completed(fixture));
    },
  };
  try {
    const provider = new Sam31LocalSegmentationProviderV1(fixture.config, runner);
    const accepted = await provider.segment(fixture.request);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executablePath, process.execPath);
    assert.deepEqual(calls[0].args.slice(0, 2), [fixture.config.scriptPath, "--request-json"]);
    assert.equal(calls[0].workingDirectory, fixture.root);
    assert.equal(calls[0].timeoutMs, 3000);
    const payload = JSON.parse(calls[0].args[2]);
    assert.equal(payload.schema, SAM31_LOCAL_SIDECAR_SCHEMA);
    assert.equal(payload.request.semanticId, fixture.request.semanticId);
    assert.equal(payload.source.absolutePath, fixture.sourcePath);
    assert.deepEqual(payload.source.evidenceIds, ["SOURCE:FRAME_1250"]);
    assert.equal(payload.checkpointPath, null);
    assert.equal(payload.confidenceThreshold, 0.55);
    assert.equal(accepted.mask.artifact.sha256, sha256(fixture.artifactBytes));
    assert.deepEqual(accepted.evidenceIds, ["SOURCE:FRAME_1250", "SAM31_MODEL:facebook/sam3.1"]);
    assert.deepEqual(provider.resolveArtifact(accepted.mask.artifact.artifactId), {
      artifactId: accepted.mask.artifact.artifactId,
      absolutePath: fixture.artifactPath,
      contentType: "image/png",
      sha256: accepted.mask.artifact.sha256,
      requestId: fixture.request.requestId,
      sourceId: fixture.request.sourceId,
      semanticId: fixture.request.semanticId,
      evidenceIds: accepted.evidenceIds,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 provider refuses unimplemented point and prior-artifact refinement before sidecar launch", async () => {
  const fixture = await makeFixture();
  let calls = 0;
  const runner = { async run() { calls += 1; return processResult(completed(fixture)); } };
  try {
    const provider = new Sam31LocalSegmentationProviderV1(fixture.config, runner);
    await assert.rejects(
      provider.segment({ ...fixture.request, prompt: { positivePoints: [{ x: 0.3, y: 0.4 }] } }),
      providerErrorCode("POINT_PROMPTS_UNSUPPORTED"),
    );
    await assert.rejects(
      provider.segment({ ...fixture.request, prompt: { previousArtifactId: "SEG_PREVIOUS" } }),
      providerErrorCode("TEMPORAL_REFINEMENT_UNSUPPORTED"),
    );
    assert.equal(calls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 provider requires exact source identity and retained source provenance", async () => {
  const fixture = await makeFixture();
  let calls = 0;
  const runner = { async run() { calls += 1; return processResult(completed(fixture)); } };
  try {
    const mismatched = new Sam31LocalSegmentationProviderV1({
      ...fixture.config,
      sourceResolver: { async resolve() { return { sourceId: "OTHER", absolutePath: fixture.sourcePath, evidenceIds: ["SOURCE:X"] }; } },
    }, runner);
    await assert.rejects(mismatched.segment(fixture.request), providerErrorCode("SOURCE_RESOLUTION_FAILED"));
    const noEvidence = new Sam31LocalSegmentationProviderV1({
      ...fixture.config,
      sourceResolver: { async resolve() { return { sourceId: fixture.request.sourceId, absolutePath: fixture.sourcePath, evidenceIds: [] }; } },
    }, runner);
    await assert.rejects(noEvidence.segment(fixture.request), providerErrorCode("SOURCE_PROVENANCE_MISSING"));
    assert.equal(calls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 provider rejects artifact path escape and byte-integrity mismatch", async () => {
  const fixture = await makeFixture();
  const outside = path.join(fixture.root, "outside.png");
  await writeFile(outside, fixture.artifactBytes);
  try {
    const escapeRunner = {
      async run() {
        return processResult(JSON.stringify({ status: "COMPLETED", artifactPath: outside, result: fixture.result }));
      },
    };
    const escapeProvider = new Sam31LocalSegmentationProviderV1(fixture.config, escapeRunner);
    await assert.rejects(escapeProvider.segment(fixture.request), providerErrorCode("ARTIFACT_PATH_ESCAPE"));

    const badDigestRunner = {
      async run() {
        return processResult(completed(fixture, {
          mask: { ...fixture.result.mask, artifact: { ...fixture.result.mask.artifact, sha256: "0".repeat(64) } },
        }));
      },
    };
    const badDigestProvider = new Sam31LocalSegmentationProviderV1(fixture.config, badDigestRunner);
    await assert.rejects(badDigestProvider.segment(fixture.request), providerErrorCode("ARTIFACT_SHA256_MISMATCH"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 provider fails closed on timeout, process failure, malformed output, and provider mismatch", async () => {
  const fixture = await makeFixture();
  try {
    const timeoutProvider = new Sam31LocalSegmentationProviderV1(fixture.config, {
      async run() { return processResult("", { timedOut: true, exitCode: null }); },
    });
    await assert.rejects(timeoutProvider.segment(fixture.request), providerErrorCode("SIDECAR_TIMEOUT"));

    const failedProvider = new Sam31LocalSegmentationProviderV1(fixture.config, {
      async run() { return processResult("", { exitCode: 2, stderr: "boom" }); },
    });
    await assert.rejects(failedProvider.segment(fixture.request), providerErrorCode("SIDECAR_PROCESS_FAILED"));

    const malformedProvider = new Sam31LocalSegmentationProviderV1(fixture.config, {
      async run() { return processResult("not-json"); },
    });
    await assert.rejects(malformedProvider.segment(fixture.request), providerErrorCode("MALFORMED_SIDECAR_JSON"));

    const mismatchProvider = new Sam31LocalSegmentationProviderV1(fixture.config, {
      async run() { return processResult(completed(fixture, { providerId: "other.provider" })); },
    });
    await assert.rejects(mismatchProvider.segment(fixture.request), providerErrorCode("PROVIDER_ID_MISMATCH"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 production adapter is shell-free and the Python sidecar cannot silently downgrade to SAM 3.0", async () => {
  const ts = await readFile("packages/adapters/sam3-local/src/index.ts", "utf8");
  const py = await readFile("packages/adapters/sam3-local/runtime/sam31_segmentation_provider.py", "utf8");
  assert.match(ts, /shell: false/);
  assert.match(ts, /ARTIFACT_SHA256_MISMATCH/);
  assert.match(ts, /TEMPORAL_REFINEMENT_UNSUPPORTED/);
  assert.match(py, /download_ckpt_from_hf\(version="sam3\.1"\)/);
  assert.doesNotMatch(py, /download_ckpt_from_hf\(version="sam3"\)/);
  assert.match(py, /load_from_HF=False/);
  assert.match(py, /torch\.autocast\(device_type="cuda", dtype=torch\.bfloat16\)/);
  assert.match(py, /previousArtifactId temporal refinement is not supported/);
  assert.match(py, /SAM31_MODEL:facebook\/sam3\.1/);
});
