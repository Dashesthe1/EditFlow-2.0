import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  M4_SAM31_LIVE_PROOF_CONFIG_SCHEMA,
  M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA,
  runSam31LiveTransferProof,
  validateLiveProofConfig,
} from "../scripts/proofs/m4-sam31-live-transfer-proof.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exists = async (filePath) => {
  try { await readFile(filePath); return true; }
  catch { return false; }
};

const makeFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-m4-sam31-live-proof-"));
  const artifactDirectory = path.join(root, "artifacts");
  const samSourceDirectory = path.join(root, "sam-src");
  await mkdir(artifactDirectory, { recursive: true });
  await mkdir(samSourceDirectory, { recursive: true });
  const pythonPath = path.join(root, "python.exe");
  const sidecarPath = path.join(root, "sidecar.py");
  const checkpointPath = path.join(root, "sam3.1_multiplex.pt");
  const sourceA = path.join(root, "source-a.mp4");
  const sourceB = path.join(root, "source-b.mp4");
  await writeFile(pythonPath, Buffer.from("python"));
  await writeFile(sidecarPath, Buffer.from("sidecar"));
  await writeFile(checkpointPath, Buffer.from("checkpoint-v1"));
  await writeFile(sourceA, Buffer.from("source-a-bytes"));
  await writeFile(sourceB, Buffer.from("source-b-bytes"));
  const config = {
    schema: M4_SAM31_LIVE_PROOF_CONFIG_SCHEMA,
    evidenceId: "M4:SAM31:LIVE:TRANSFER:TEST001",
    pythonPath,
    sidecarPath,
    workingDirectory: root,
    artifactDirectory,
    checkpointPath,
    samSourceDirectory,
    proofOutputPath: path.join(root, "proof.json"),
    runtimeEvidencePath: path.join(root, "runtime-evidence.json"),
    timeoutMs: 10000,
    confidenceThreshold: 0.5,
    fixtures: [
      {
        fixtureId: "fixture-a",
        sourceId: "SOURCE_A",
        semanticId: "SUBJECT_A",
        entityClass: "person",
        sourcePath: sourceA,
        startFrameIndex: 0,
        frameRate: 30,
        frameCount: 2,
        promptFrameIndex: 0,
        boundingBox: [0.15, 0.1, 0.4, 0.75],
      },
      {
        fixtureId: "fixture-b",
        sourceId: "SOURCE_B",
        semanticId: "SUBJECT_B",
        entityClass: "person",
        sourcePath: sourceB,
        startFrameIndex: 3,
        frameRate: 30,
        frameCount: 2,
        promptFrameIndex: 1,
        boundingBox: [0.35, 0.2, 0.35, 0.65],
      },
    ],
  };
  return {
    root,
    config,
    sourceA,
    sourceB,
    cleanup: async () => await rm(root, { recursive: true, force: true }),
  };
};

const fakeProviderFactory = ({ fixture, sourceMaterial, artifactDirectory }) => {
  let verified = null;
  return {
    async segmentSequence(request) {
      const verifiedFrames = [];
      const resultFrames = [];
      for (let index = 0; index < request.frameCount; index += 1) {
        const bytes = Buffer.from(`${fixture.maskContentId ?? fixture.fixtureId}-mask-${index}`);
        const artifactPath = path.join(artifactDirectory, `mask-${index}.png`);
        await writeFile(artifactPath, bytes);
        const digest = sha256(bytes);
        verifiedFrames.push({
          frameIndex: index,
          artifactId: `artifact:${fixture.fixtureId}:${index}`,
          absolutePath: artifactPath,
          contentType: "image/png",
          sha256: digest,
          evidenceIds: sourceMaterial.evidenceIds,
        });
        resultFrames.push({
          frameIndex: index,
          timestampMs: request.startTimestampMs + index * 1000 / request.frameRate,
          mask: {
            encoding: "ALPHA",
            width: 64,
            height: 64,
            boundsNormalized: [0, 0, 1, 1],
            artifact: {
              artifactId: `artifact:${fixture.fixtureId}:${index}`,
              contentType: "image/png",
              sha256: digest,
            },
          },
          confidence: 0.9,
          edgeQuality: 0.85,
          temporalConsistency: index === 0 ? 1 : 0.9,
          occlusion: 0.05,
          evidenceIds: sourceMaterial.evidenceIds,
        });
      }
      const evidenceIds = [
        ...sourceMaterial.evidenceIds,
        "SAM31_MODEL:facebook/sam3.1",
        "SAM31_CHECKPOINT:LOCAL_EXPLICIT",
        "SAM31_TEMPORAL:VIDEO_SESSION_PROPAGATION",
      ];
      verified = {
        requestId: request.requestId,
        sourceId: request.sourceId,
        semanticId: request.semanticId,
        frameRate: request.frameRate,
        frameCount: request.frameCount,
        frames: verifiedFrames,
        evidenceIds,
      };
      return {
        ...request,
        providerId: "sam3.1.local",
        providerVersion: "sam3.1:code-test",
        frames: resultFrames,
        evidenceIds,
      };
    },
    resolveSequence(requestId) {
      return verified?.requestId === requestId ? verified : null;
    },
  };
};

const deps = {
  providerFactory: fakeProviderFactory,
  samCommitResolver: () => "a".repeat(40),
  now: () => new Date("2026-09-14T23:59:00.000Z"),
};
test("M4 SAM 3.1 live proof emits digest-bound runtime evidence only after all gates pass", async () => {
  const fixture = await makeFixture();
  try {
    const result = await runSam31LiveTransferProof(fixture.config, deps);
    const proofBytes = await readFile(fixture.config.proofOutputPath);
    const proof = JSON.parse(proofBytes.toString("utf8"));
    const evidenceBytes = await readFile(fixture.config.runtimeEvidencePath);
    const evidence = JSON.parse(evidenceBytes.toString("utf8"));
    const sidecar = (await readFile(`${fixture.config.runtimeEvidencePath}.sha256`, "utf8")).trim();
    assert.equal(proof.classification, "LIVE_ACCEPTANCE");
    assert.equal(proof.afterEffects.controlActionsIssued, 0);
    assert.equal(proof.afterEffects.projectMutationRequested, false);
    assert.equal(evidence.schema, M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA);
    assert.equal(evidence.sourceFixtureCount, 2);
    assert.equal(evidence.liveInferenceAccepted, true);
    assert.equal(evidence.exactCorrelationAccepted, true);
    assert.equal(evidence.perFrameSha256Accepted, true);
    assert.equal(evidence.materiallyDifferentTransferAccepted, true);
    assert.equal(evidence.noHiddenFallbackAccepted, true);
    assert.match(evidence.checkpointSha256, /^[0-9a-f]{64}$/);
    assert.match(evidence.resultSha256, /^[0-9a-f]{64}$/);
    assert.equal(sidecar, sha256(evidenceBytes));
    assert.equal(result.runtimeEvidenceFileSha256, sidecar);
  } finally {
    await fixture.cleanup();
  }
});
test("M4 SAM 3.1 live proof rejects duplicate source bytes before provider construction", async () => {
  const fixture = await makeFixture();
  let providerCalls = 0;
  try {
    await writeFile(fixture.sourceB, await readFile(fixture.sourceA));
    await assert.rejects(
      () => runSam31LiveTransferProof(fixture.config, {
        ...deps,
        providerFactory: (args) => {
          providerCalls += 1;
          return fakeProviderFactory(args);
        },
      }),
      /MATERIALLY_DIFFERENT_SOURCE_BYTES_REQUIRED/,
    );
    assert.equal(providerCalls, 0);
    assert.equal(await exists(fixture.config.runtimeEvidencePath), false);
    assert.equal(await exists(`${fixture.config.runtimeEvidencePath}.sha256`), false);
  } finally {
    await fixture.cleanup();
  }
});
test("M4 SAM 3.1 live proof refuses identical verified mask sequences across distinct sources", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(
      () => runSam31LiveTransferProof(fixture.config, {
        ...deps,
        providerFactory: (args) => fakeProviderFactory({
          ...args,
          fixture: { ...args.fixture, maskContentId: "same-mask-output" },
        }),
      }),
      /MATERIALLY_DIFFERENT_SEQUENCE_OUTPUT_REQUIRED/,
    );
    assert.equal(await exists(fixture.config.proofOutputPath), false);
    assert.equal(await exists(fixture.config.runtimeEvidencePath), false);
    assert.equal(await exists(`${fixture.config.runtimeEvidencePath}.sha256`), false);
  } finally {
    await fixture.cleanup();
  }
});
test("M4 SAM 3.1 live proof refuses missing native SAM 3.1 provenance", async () => {
  const fixture = await makeFixture();
  try {
    const fallbackFactory = (args) => {
      const provider = fakeProviderFactory(args);
      return {
        ...provider,
        segmentSequence: async (request) => {
          const result = await provider.segmentSequence(request);
          return {
            ...result,
            evidenceIds: result.evidenceIds.filter((id) => id !== "SAM31_TEMPORAL:VIDEO_SESSION_PROPAGATION"),
          };
        },
      };
    };
    await assert.rejects(
      () => runSam31LiveTransferProof(fixture.config, { ...deps, providerFactory: fallbackFactory }),
      /HIDDEN_FALLBACK_OR_PROVENANCE_MISSING/,
    );
    assert.equal(await exists(fixture.config.runtimeEvidencePath), false);
  } finally {
    await fixture.cleanup();
  }
});
