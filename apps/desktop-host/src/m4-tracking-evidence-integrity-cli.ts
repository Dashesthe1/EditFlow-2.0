import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name: string): string => {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return path.resolve(value);
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const stripBom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const insideOrEqual = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const sha256 = async (filePath: string): Promise<string> => createHash("sha256").update(await readFile(filePath)).digest("hex");

interface ArtifactDigest {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly role: string;
}

const digestArtifact = async (root: string, filePath: string, role: string): Promise<ArtifactDigest> => {
  const resolved = path.resolve(filePath);
  if (!insideOrEqual(root, resolved)) throw new Error(`Evidence artifact escaped bounded root: ${resolved}`);
  const info = await stat(resolved);
  if (!info.isFile() || info.size <= 0) throw new Error(`Evidence artifact is missing or empty: ${resolved}`);
  return {
    relativePath: path.relative(root, resolved).replaceAll(path.sep, "/"),
    sizeBytes: info.size,
    sha256: await sha256(resolved),
    role,
  };
};

const main = async (): Promise<void> => {
  const artifactRoot = required("--artifact-root");
  const trackingResultPath = required("--tracking-result");
  const semanticResultPath = required("--semantic-result");
  const resultPath = required("--result");
  let report: Record<string, unknown>;
  try {
    if (!insideOrEqual(artifactRoot, resultPath)) throw new Error("Integrity result path must stay inside the artifact root.");
    const tracking = record(JSON.parse(stripBom(await readFile(trackingResultPath, "utf8"))) as unknown);
    const semantic = record(JSON.parse(stripBom(await readFile(semanticResultPath, "utf8"))) as unknown);
    if (!tracking || tracking["proofId"] !== "M4_POINT_TRACK_REAL_AE_V1" || tracking["ok"] !== true || tracking["classification"] !== "PASS") {
      throw new Error("Integrity stage requires a passing M4_POINT_TRACK_REAL_AE_V1 tracking result.");
    }
    if (!semantic || semantic["proofId"] !== "M4_TRACK_TO_BRAIN_DECISION_ONLY_V1" || semantic["ok"] !== true || semantic["classification"] !== "PASS_DECISION_ONLY_FAIL_CLOSED") {
      throw new Error("Integrity stage requires a passing semantic/Editor Brain decision-only result.");
    }
    const manifest = record(tracking["manifest"]);
    const renderReadback = record(tracking["renderReadback"]);
    if (!manifest || !Array.isArray(manifest["framePaths"]) || !(manifest["framePaths"] as unknown[]).every((entry) => typeof entry === "string")) {
      throw new Error("Tracking result does not contain an exact frame manifest.");
    }
    const completionPath = renderReadback?.["completionPath"];
    const frameManifestPath = renderReadback?.["trackingSequenceManifestPath"];
    if (typeof completionPath !== "string" || typeof frameManifestPath !== "string") throw new Error("Tracking result is missing render lifecycle evidence paths.");

    const artifacts: ArtifactDigest[] = [];
    artifacts.push(await digestArtifact(artifactRoot, trackingResultPath, "tracking_result"));
    artifacts.push(await digestArtifact(artifactRoot, semanticResultPath, "semantic_brain_result"));
    artifacts.push(await digestArtifact(artifactRoot, completionPath, "render_lifecycle_marker"));
    artifacts.push(await digestArtifact(artifactRoot, frameManifestPath, "tracking_frame_manifest"));
    for (const framePath of manifest["framePaths"] as string[]) artifacts.push(await digestArtifact(artifactRoot, framePath, "tracking_tiff_frame"));
    artifacts.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
    const canonical = artifacts.map((artifact) => `${artifact.role}\t${artifact.relativePath}\t${artifact.sizeBytes}\t${artifact.sha256}`).join("\n");
    const evidenceSetSha256 = createHash("sha256").update(canonical, "utf8").digest("hex");
    report = {
      proofId: "M4_POINT_TRACK_EVIDENCE_INTEGRITY_V1",
      parentTrackingProofId: "M4_POINT_TRACK_REAL_AE_V1",
      parentSemanticProofId: "M4_TRACK_TO_BRAIN_DECISION_ONLY_V1",
      ok: true,
      classification: "PASS",
      algorithm: "SHA-256",
      artifactRoot,
      artifactCount: artifacts.length,
      artifacts,
      evidenceSetSha256,
    };
  } catch (error) {
    report = {
      proofId: "M4_POINT_TRACK_EVIDENCE_INTEGRITY_V1",
      ok: false,
      classification: "PROOF_FAILURE",
      error: error instanceof Error ? error.message : String(error),
    };
    process.exitCode = 1;
  }
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

await main();
