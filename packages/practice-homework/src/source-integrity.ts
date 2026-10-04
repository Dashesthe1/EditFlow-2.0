import type { PracticeSceneMatchV1 } from "./contracts.js";
const uniqueRefs = (refs: readonly string[]): readonly string[] => [...new Set(refs.filter(ref => ref.trim()))];
/** Direct GPT comparisons are source evidence, never fabricated geometric metrics. */
export const hasVerifiedPracticeSourceIdentityV1 = (match: PracticeSceneMatchV1): boolean => {
  if (match.selectionMode !== "CHATGPT_DIRECT") return false;
  const proof = match.chatgptSelection;
  return proof?.authority === "CHATGPT_DIRECT" && !!proof.decisionId?.trim()
    && !!proof.rationale?.trim() && Number.isFinite(Date.parse(proof.reviewedAt))
    && Array.isArray(proof.anchors) && proof.anchors.length >= 3
    && new Set(proof.anchors.map((anchor) => anchor.referenceTimeMs)).size >= 3
    && proof.anchors.every((anchor) => Number.isFinite(anchor.referenceTimeMs)
      && Number.isFinite(anchor.sourceTimeMs) && !!anchor.observation?.trim()
      && /^[a-f0-9]{24}$/.test(anchor.referenceEvidenceId) && /^[a-f0-9]{24}$/.test(anchor.sourceEvidenceId));
};

export const validatePracticeSceneMatchesV1 = (
  shotIds: readonly string[],
  matches: readonly PracticeSceneMatchV1[],
  minimumConfidence: number,
): readonly string[] => {
  const reasons: string[] = [];
  const byShot = new Map(matches.map((match) => [match.shotId, match]));
  for (const shotId of shotIds) {
    const match = byShot.get(shotId);
    if (match === undefined) {
      reasons.push("No source scene match was found for " + shotId + ".");
      continue;
    }
    if (match.confidence < minimumConfidence) {
      reasons.push("Source match confidence for " + shotId + " is below the exact-scene gate.");
    } else if (!hasVerifiedPracticeSourceIdentityV1(match)) {
      reasons.push(
        "Source match for " + shotId
          + " lacks retained direct ChatGPT comparisons required by the exact-scene gate.",
      );
    }
    if (match.sourceEndMs <= match.sourceStartMs) {
      reasons.push("Source match for " + shotId + " has an invalid time range.");
    }
    if (!Number.isFinite(match.playbackRate) || match.playbackRate <= 0) {
      reasons.push("Source match for " + shotId + " has an invalid playback rate.");
    }
  }
  if (byShot.size !== shotIds.length) {
    reasons.push("Scene matching must produce exactly one retained match per reference shot.");
  }
  return uniqueRefs(reasons);
};

