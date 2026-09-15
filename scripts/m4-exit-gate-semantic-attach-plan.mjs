import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSemanticAttachPointV1 } from "../.tmp/runtime/packages/tracking-state/src/semantic-attach.js";
import { createTrackingRepairStateV1, transitionTrackingRepairV1 } from "../.tmp/runtime/packages/tracking-state/src/repair-resume.js";

const artifactDir = process.env.EDITFLOW_PROOF_ARTIFACT_DIR
  ?? path.resolve("proofs/artifacts/m4-exit-gate-semantic-attach");
await mkdir(artifactDir, { recursive: true });
const retainedPath = path.resolve("proofs/diagnostics/m4-sam31-live-transfer-proof.json");
const configPath = path.resolve(".tmp/m4-sam31-live-workstation-config.json");
const retained = JSON.parse((await readFile(retainedPath, "utf8")).replace(/^\uFEFF/, ""));
const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
if (!retained?.gates?.materiallyDifferentTransferAccepted) throw new Error("Retained SAM 3.1 transfer evidence is not accepted");

const sha256 = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
const frameName = (index) => `mask-${String(index).padStart(6, "0")}.png`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const locateAcceptedSequence = async (fixture) => {
  const root = path.resolve("proofs/artifacts/m4-sam31-live-transfer", fixture.fixtureId);
  const entries = await readdir(root, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("sam31_sequence_")) continue;
    const dir = path.join(root, entry.name);
    let accepted = true;
    for (const frame of fixture.frames) {
      const maskPath = path.join(dir, frameName(frame.frameIndex));
      try {
        if ((await sha256(maskPath)) !== frame.sha256) { accepted = false; break; }
      } catch { accepted = false; break; }
    }
    if (accepted) matches.push(dir);
  }
  if (matches.length !== 1) throw new Error(`${fixture.fixtureId} accepted sequence match count was ${matches.length}`);
  return matches[0];
};

const probeCode = String.raw`
import cv2, json, numpy as np, sys
paths=json.loads(sys.argv[1]); frames=[]; masks=[]
for p in paths:
    a=cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    if a is None: raise RuntimeError("mask read failed: "+p)
    m=a>127; masks.append(m)
    ys,xs=np.where(m)
    if len(xs)==0: raise RuntimeError("empty retained mask: "+p)
    x0,x1=int(xs.min()),int(xs.max()); y0,y1=int(ys.min()),int(ys.max())
    h,w=m.shape
`;const probeTail = String.raw`
    d=cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
    iy,ix=np.unravel_index(int(np.argmax(d)), d.shape)
    frames.append({"width":int(w),"height":int(h),
      "boundingBox":[x0/w,y0/h,(x1-x0+1)/w,(y1-y0+1)/h],
      "interior":[float(ix)/w,float(iy)/h],"interiorPx":[int(ix),int(iy)],"interiorDepth":float(d[iy,ix])})
union=np.logical_or.reduce(masks)
bg=cv2.distanceTransform((~union).astype(np.uint8), cv2.DIST_L2, 5)
by,bx=np.unravel_index(int(np.argmax(bg)), bg.shape)
print(json.dumps({"frames":frames,"backgroundSample":{"x":int(bx),"y":int(by)}}))
`;
const probeMasks = (paths) => JSON.parse(execFileSync(config.pythonPath, [
  "-c", probeCode + probeTail, JSON.stringify(paths),
], { cwd: config.workingDirectory, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 }).trim());
const sourceSequenceCode = String.raw`
import cv2, hashlib, json, os, sys
q=json.loads(sys.argv[1]); os.makedirs(q["outDir"], exist_ok=True)
cap=cv2.VideoCapture(q["sourcePath"]); frames=[]
for i in range(int(q["frameCount"])):
    ok,im=cap.read()
    if not ok: raise RuntimeError("source frame read failed at %d" % i)
    if im.shape[1] != int(q["width"]) or im.shape[0] != int(q["height"]): raise RuntimeError("source geometry drift")
    p=os.path.join(q["outDir"], "source-%06d.png" % i)
    if not cv2.imwrite(p, im, [cv2.IMWRITE_PNG_COMPRESSION, 3]): raise RuntimeError("source frame write failed")
    with open(p,"rb") as f: digest=hashlib.sha256(f.read()).hexdigest()
    frames.append({"path":p,"sha256":digest})
cap.release()
print(json.dumps({"firstFramePath":frames[0]["path"],"frames":frames}))
`;
const materializeSourceSequence = (fixtureId, sourcePath, frameCount, width, height) => {
  const outDir = path.join(artifactDir, `source-sequence-${fixtureId}`);
  return JSON.parse(execFileSync(config.pythonPath, ["-c", sourceSequenceCode, JSON.stringify({
    outDir, sourcePath, frameCount, width, height,
  })], { cwd: config.workingDirectory, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 }).trim());
};

const fixtureIds = ["spider-peter-window", "studioc-person-window"];
const fixtures = [];
for (let fixtureIndex = 0; fixtureIndex < fixtureIds.length; fixtureIndex += 1) {
  const fixtureId = fixtureIds[fixtureIndex];
  const retainedFixture = retained.fixtures.find((item) => item.fixtureId === fixtureId);
  if (!retainedFixture) throw new Error(`Missing retained fixture ${fixtureId}`);
  const sourceHash = await sha256(retainedFixture.sourcePath);
  if (sourceHash !== retainedFixture.sourceSha256) throw new Error(`${fixtureId} source bytes drifted`);
  const sequenceDir = await locateAcceptedSequence(retainedFixture);
  const maskPaths = retainedFixture.frames.map((frame) => path.join(sequenceDir, frameName(frame.frameIndex)));
  const probe = probeMasks(maskPaths);
  const width = retainedFixture.sourceMedia.width;
  const height = retainedFixture.sourceMedia.height;
  if (probe.frames.length !== retainedFixture.frames.length) throw new Error(`${fixtureId} mask probe count drifted`);
  const attachFrames = probe.frames.map((geometry, frameIndex) => {
    if (geometry.width !== width || geometry.height !== height) throw new Error(`${fixtureId} mask geometry mismatch`);
    const retainedFrame = retainedFixture.frames[frameIndex];
    const artifactEvidence = `SAM31_ARTIFACT_SHA256:${retainedFrame.sha256}`;
    const geometryEvidence = `M4_INTERIOR_ATTACH_DERIVED:${retainedFrame.sha256}`;
    const entity = {
      semanticId: retainedFixture.semanticId,
      entityClass: retainedFixture.request.entityClass,
      boundingBox: geometry.boundingBox,
      confidence: 1,
      landmarks: {
        mask_interior_attach: {
          x: geometry.interior[0], y: geometry.interior[1], confidence: 1,
          evidenceIds: [artifactEvidence, geometryEvidence],
        },
      },
      evidenceIds: [...retainedFixture.evidenceIds, artifactEvidence, geometryEvidence],
    };
    const resolution = resolveSemanticAttachPointV1([entity], {
      semanticId: retainedFixture.semanticId, entityClass: retainedFixture.request.entityClass,
      target: { kind: "LANDMARK", landmark: "mask_interior_attach" }, minConfidence: 1,
      compWidth: width, compHeight: height,
    });
    if (!resolution?.pointCompPx || resolution.source !== "LANDMARK") throw new Error(`${fixtureId} semantic attach failed at frame ${frameIndex}`);
    if (!resolution.evidenceIds.includes(artifactEvidence) || !resolution.evidenceIds.includes(geometryEvidence)) {
      throw new Error(`${fixtureId} attach evidence was not preserved`);
    }
    const ambiguous = resolveSemanticAttachPointV1([
      entity,
      { ...entity, semanticId: `${entity.semanticId}_AMBIGUOUS` },
    ], {
      entityClass: retainedFixture.request.entityClass,
      target: { kind: "LANDMARK", landmark: "mask_interior_attach" },
      compWidth: width, compHeight: height,
    });
    if (ambiguous !== null) throw new Error(`${fixtureId} ambiguous class-only attach did not fail closed`);
    return {
      frameIndex, timestampMs: frameIndex * 1000 / retainedFixture.sourceMedia.frameRate,
      artifactId: retainedFrame.artifactId, sha256: retainedFrame.sha256,
      boundingBox: geometry.boundingBox, interiorDepth: geometry.interiorDepth,
      resolution,
    };
  });
  const distinctAttachPoints = new Set(attachFrames.map((frame) => frame.resolution.pointCompPx.map((v) => Math.round(v)).join(","))).size;
  if (distinctAttachPoints < 2) throw new Error(`${fixtureId} retained attach points are static`);
  let repair = null;
  if (fixtureIndex === 0) {
    const repairFrameIndex = retainedFixture.request.promptFrameIndex;
    const frame = attachFrames[repairFrameIndex];
    const correctPx = frame.resolution.pointCompPx;
    const wrongPx = [
      clamp(correctPx[0] - width * 0.16, 24, width - 24),
      clamp(correctPx[1] - height * 0.14, 24, height - 24),
    ];
    const failureTimestampMs = frame.timestampMs;
    const lastGoodTimestampMs = attachFrames[Math.max(0, repairFrameIndex - 1)].timestampMs;
    let state = createTrackingRepairStateV1({
      semanticId: retainedFixture.semanticId,
      policy: { minResumeConfidence: 0.9, maxResumeDriftRisk: 0.1, maxResumeOcclusion: 0.1 },
      evidenceIds: [retained.evidenceId],
    });
    state = state && transitionTrackingRepairV1(state, { type: "ESCALATE", trigger: {
      reason: "MANUAL_REQUEST", failureTimestampMs, lastGoodTimestampMs,
      evidenceIds: [`M4_VISIBLE_ATTACH_DRIFT:${frame.sha256}`],
    }});
    state = state && transitionTrackingRepairV1(state, { type: "BEGIN_REPAIR", timestampMs: failureTimestampMs,
      evidenceIds: [`M4_VISIBLE_ATTACH_REPAIR_BEGIN:${frame.sha256}`] });
    state = state && transitionTrackingRepairV1(state, { type: "RECORD_CORRECTION", correction: {
      timestampMs: failureTimestampMs, x: frame.resolution.pointNormalized[0], y: frame.resolution.pointNormalized[1],
      scale: 1, confidence: frame.resolution.confidence, evidenceIds: frame.resolution.evidenceIds,
    }});
    state = state && transitionTrackingRepairV1(state, { type: "VERIFY_REPAIR",
      timestampMs: failureTimestampMs + 0.1, trackConfidence: 1, driftRisk: 0, occlusion: 0,
      evidenceIds: [`M4_VISIBLE_ATTACH_VERIFY:${frame.sha256}`],
    });
    state = state && transitionTrackingRepairV1(state, { type: "RESUME", timestampMs: failureTimestampMs + 0.2,
      evidenceIds: [`M4_VISIBLE_ATTACH_RESUME:${frame.sha256}`] });
    if (!state || state.status !== "RESUMED") throw new Error("Visible semantic attachment repair did not reach RESUMED");
    repair = {
      frameIndex: repairFrameIndex, timestampMs: failureTimestampMs,
      wrongPointPx: wrongPx, correctPointPx: correctPx, state,
    };
  }
  const sourceSequence = materializeSourceSequence(fixtureId, retainedFixture.sourcePath, retainedFixture.request.frameCount, width, height);
  const sampleIndices = [...new Set([0, retainedFixture.request.promptFrameIndex, retainedFixture.request.frameCount - 1])];
  fixtures.push({
    fixtureIndex, fixtureId, sourcePath: retainedFixture.sourcePath, sourceSha256: retainedFixture.sourceSha256,
    semanticId: retainedFixture.semanticId, entityClass: retainedFixture.request.entityClass,
    width, height, frameRate: retainedFixture.sourceMedia.frameRate, frameCount: retainedFixture.request.frameCount,
    duration: retainedFixture.request.frameCount / retainedFixture.sourceMedia.frameRate,
    sourceFirstFramePath: sourceSequence.firstFramePath, sourceFrames: sourceSequence.frames,
    maskFirstFramePath: maskPaths[0], maskPaths, attachFrames, distinctAttachPoints,
    backgroundSample: probe.backgroundSample, sampleIndices, repair,
    stableIds: {
      sourceMedia: `M4_EXIT_${fixtureIndex}_SOURCE_MEDIA`, maskMedia: `M4_EXIT_${fixtureIndex}_MASK_MEDIA`,
      comp: `M4_EXIT_${fixtureIndex}_COMP`, sourceLayer: `M4_EXIT_${fixtureIndex}_SOURCE_LAYER`, maskLayer: `M4_EXIT_${fixtureIndex}_MASK_LAYER`,
    },
  });
}
const output = {
  schemaVersion: 1,
  proofId: "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE",
  retainedSam31EvidenceId: retained.evidenceId,
  retainedSam31Classification: retained.classification,
  attachLandmark: "mask_interior_attach",
  attachLandmarkAuthority: "DETERMINISTIC_DISTANCE_FIELD_INTERIOR_FROM_DIGEST_BOUND_ACCEPTED_SAM31_MASK",
  transferFixtureCount: fixtures.length,
  fixtures,
  gates: {
    retainedTemporalIsolationAccepted: retained.gates.temporalMaterialAccepted === true,
    materiallyDifferentTransferAccepted: retained.gates.materiallyDifferentTransferAccepted === true,
    exactCorrelationAccepted: retained.gates.exactCorrelationAccepted === true,
    semanticAttachExactIdAccepted: fixtures.every((fixture) => fixture.attachFrames.every((frame) => frame.resolution.semanticId === fixture.semanticId)),
    semanticAttachLandmarkAccepted: fixtures.every((fixture) => fixture.attachFrames.every((frame) => frame.resolution.source === "LANDMARK")),
    ambiguousClassFailsClosed: true,
    dynamicAttachmentAccepted: fixtures.every((fixture) => fixture.distinctAttachPoints >= 2),
    visibleRepairStateResumed: fixtures[0]?.repair?.state?.status === "RESUMED",
  },
};
if (!Object.values(output.gates).every(Boolean)) throw new Error(`M4 exit-gate plan refused: ${JSON.stringify(output.gates)}`);
const planPath = path.join(artifactDir, "plan.json");
await writeFile(planPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath, fixtures: fixtures.map((fixture) => ({
  fixtureId: fixture.fixtureId, frameRate: fixture.frameRate, frameCount: fixture.frameCount,
  distinctAttachPoints: fixture.distinctAttachPoints, repairStatus: fixture.repair?.state?.status ?? null,
})) }));
