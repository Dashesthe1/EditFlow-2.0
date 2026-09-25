import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluatePracticeRetainedTruthSuiteV1,
  type PracticeRetainedTruthCaseV1,
  type PracticeRetainedTruthObservationV1,
  type PracticeRetainedTruthSuiteModeV1,
  type PracticeRetainedTruthSuiteReportV1,
} from "../../../packages/practice-homework/src/index.js";

export interface PracticeRetainedTruthManifestSourceV1 {
  readonly path: string;
  readonly sha256: string;
}

export interface PracticeRetainedTruthManifestCaseV1 {
  readonly finishPath: string;
  readonly sourceMedia: readonly PracticeRetainedTruthManifestSourceV1[];
  readonly truth: PracticeRetainedTruthCaseV1;
  readonly observation: PracticeRetainedTruthObservationV1;
}

export interface PracticeRetainedTruthSuiteManifestV1 {
  readonly schema: "editflow.practice-retained-truth-suite-manifest.v1";
  readonly editTypeId: string;
  readonly mode: PracticeRetainedTruthSuiteModeV1;
  readonly cases: readonly PracticeRetainedTruthManifestCaseV1[];
}
const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const uniqueNonEmpty = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const sameShaSet = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  const normalizedLeft = [...new Set(left.map((value) => value.trim().toLowerCase()))]
    .sort();
  const normalizedRight = [...new Set(right.map((value) => value.trim().toLowerCase()))]
    .sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const resolveManifestMediaPath = (
  manifestPath: string,
  mediaPath: string,
): string => path.isAbsolute(mediaPath)
  ? path.normalize(mediaPath)
  : path.resolve(path.dirname(manifestPath), mediaPath);

const parseManifest = async (
  manifestPath: string,
): Promise<PracticeRetainedTruthSuiteManifestV1> => {
  const parsed = JSON.parse(
    (await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""),
  ) as Partial<PracticeRetainedTruthSuiteManifestV1>;
  if (parsed.schema !== "editflow.practice-retained-truth-suite-manifest.v1"
    || typeof parsed.editTypeId !== "string"
    || (parsed.mode !== "CERTIFICATION" && parsed.mode !== "MEASURE_ONLY")
    || !Array.isArray(parsed.cases)) {
    throw new TypeError("Practice retained truth-suite manifest has an unsupported schema.");
  }
  return parsed as PracticeRetainedTruthSuiteManifestV1;
};

export const evaluatePracticeRetainedTruthSuiteManifestV1 = async (
  manifestFilePath: string,
): Promise<PracticeRetainedTruthSuiteReportV1> => {
  const manifestPath = path.resolve(manifestFilePath);
  const manifest = await parseManifest(manifestPath);
  const verifiedCases = [];

  for (const item of manifest.cases) {
    const caseId = item.truth.caseId.trim();
    const finishPath = resolveManifestMediaPath(manifestPath, item.finishPath);
    const finishSha256 = await sha256File(finishPath);
    if (finishSha256 !== item.truth.finishSha256.trim().toLowerCase()) {
      throw new Error(
        "PRACTICE_TRUTH_FINISH_SHA256_MISMATCH:"
          + caseId
          + ":"
          + finishSha256,
      );
    }
    if (!Array.isArray(item.sourceMedia) || item.sourceMedia.length === 0) {
      throw new Error("PRACTICE_TRUTH_SOURCE_MEDIA_MISSING:" + caseId);
    }
    const actualSourceSha256: string[] = [];
    const sourceEvidenceRefs: string[] = [];
    for (const source of item.sourceMedia) {
      const sourcePath = resolveManifestMediaPath(manifestPath, source.path);
      const actualSha256 = await sha256File(sourcePath);
      if (actualSha256 !== source.sha256.trim().toLowerCase()) {
        throw new Error(
          "PRACTICE_TRUTH_SOURCE_SHA256_MISMATCH:"
            + caseId
            + ":"
            + actualSha256,
        );
      }
      actualSourceSha256.push(actualSha256);
      sourceEvidenceRefs.push("retained-source-sha256:" + actualSha256);
    }
    if (!sameShaSet(actualSourceSha256, item.truth.sourceMediaSha256)) {
      throw new Error(
        "PRACTICE_TRUTH_SOURCE_SET_MISMATCH:"
          + caseId,
      );
    }

    const finishEvidenceRef = "retained-finish-sha256:" + finishSha256;
    const mediaEvidenceRefs = uniqueNonEmpty([
      finishEvidenceRef,
      ...sourceEvidenceRefs,
    ]);
    verifiedCases.push({
      truth: {
        ...item.truth,
        finishSha256,
        sourceMediaSha256: actualSourceSha256,
        evidenceRefs: uniqueNonEmpty([
          ...item.truth.evidenceRefs,
          ...mediaEvidenceRefs,
        ]),
      },
      observation: {
        ...item.observation,
        evidenceRefs: uniqueNonEmpty([
          ...item.observation.evidenceRefs,
          ...mediaEvidenceRefs,
        ]),
      },
    });
  }

  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: manifest.editTypeId,
    mode: manifest.mode,
    cases: verifiedCases,
  });
  const authorityManifestSha256 = await sha256File(manifestPath);
  const authorityMediaSha256 = uniqueNonEmpty(verifiedCases.flatMap((item) => [
    item.truth.finishSha256,
    ...item.truth.sourceMediaSha256,
  ])).sort();
  const authorityPayload = JSON.stringify({
    schema: "editflow.practice-retained-truth-authority.v1",
    editTypeId: manifest.editTypeId,
    mode: manifest.mode,
    manifestSha256: authorityManifestSha256,
    mediaSha256: authorityMediaSha256,
  });
  const authorityRef = "practice-retained-truth-authority:sha256:"
    + createHash("sha256").update(authorityPayload, "utf8").digest("hex");
  return {
    ...report,
    authorityRef,
    authorityManifestSha256,
  };
};
