import { createHash } from "node:crypto";
import {
  asEnvironmentFingerprint,
  asPlanHash,
  asProjectFingerprint,
  type EnvironmentFingerprint,
  type PlanHash,
  type ProjectFingerprint,
} from "../../core-contracts/src/index.js";

const normalize = (value: unknown): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Fingerprint input contains a non-finite number.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) {
        throw new TypeError(`Fingerprint input contains undefined at key '${key}'.`);
      }
      output[key] = normalize(entry);
    }
    return output;
  }
  throw new TypeError(`Unsupported fingerprint input type: ${typeof value}.`);
};

export const canonicalStringify = (value: unknown): string => JSON.stringify(normalize(value));

export const sha256Hex = (value: unknown): string =>
  createHash("sha256").update(canonicalStringify(value)).digest("hex");

export const computeProjectFingerprint = (value: unknown): ProjectFingerprint =>
  asProjectFingerprint(`project:sha256:${sha256Hex(value)}`);

export const computeEnvironmentFingerprint = (value: unknown): EnvironmentFingerprint =>
  asEnvironmentFingerprint(`environment:sha256:${sha256Hex(value)}`);

export const computePlanHash = (value: unknown): PlanHash =>
  asPlanHash(`plan:sha256:${sha256Hex(value)}`);
