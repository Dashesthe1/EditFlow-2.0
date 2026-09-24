const DHASH_HEX = /^[0-9a-f]{16}$/i;

const signatureParts = (value: string | undefined): readonly string[] => {
  if (value === undefined) return [];
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 8 && parts.every((part) => DHASH_HEX.test(part)) ? parts : [];
};

const bitCount = (value: bigint): number => {
  let remaining = value;
  let count = 0;
  while (remaining !== 0n) {
    remaining &= remaining - 1n;
    count += 1;
  }
  return count;
};

export const practicePerceptualSignatureSimilarityV1 = (
  left: string | undefined,
  right: string | undefined,
): number | null => {
  const a = signatureParts(left);
  const b = signatureParts(right);
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return null;  let similarity = 0;
  for (let index = 0; index < a.length; index += 1) {
    const xor = BigInt("0x" + a[index]!) ^ BigInt("0x" + b[index]!);
    similarity += 1 - bitCount(xor) / 64;
  }
  return similarity / a.length;
};

export const practicePerceptualSignatureMatchesV1 = (
  left: string | undefined,
  right: string | undefined,
  minimumSimilarity = 0.96,
): boolean => {
  const similarity = practicePerceptualSignatureSimilarityV1(left, right);
  return similarity !== null && similarity >= minimumSimilarity;
};

export const practicePerceptualSetOverlapsV1 = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
  minimumSimilarity = 0.96,
): boolean => (left ?? []).some((a) =>
  (right ?? []).some((b) => practicePerceptualSignatureMatchesV1(a, b, minimumSimilarity)));
