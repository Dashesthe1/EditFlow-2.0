import path from "node:path";

import {
  NodeTrackerVisualSidecarRunnerV1,
  type TrackerVisualSidecarProcessResultV1,
  type TrackerVisualSidecarRunnerV1,
} from "./m4-editgpt-tracker-visual-driver.js";
import type {
  RotoBrushPropagationVisualDriverV1,
  RotoBrushPropagationVisualRequestV1,
  RotoBrushPropagationVisualResultV1,
} from "./m5-roto-brush-propagation-controller.js";

export interface EditGptRotoBrushPropagationVisualDriverConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly evidenceDirectory?: string | null;
  readonly timeoutMs?: number;
}

const absolute = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const assertAbsolute = (name: string, value: string): void => {
  if (!value || !absolute(value)) throw new TypeError(`${name} must be a non-empty absolute path.`);
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const cleanLatencies = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) return [];
  const values = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0);
  return values.length === value.length ? Object.freeze([...values]) : [];
};
const refuse = (detail: string, evidence: string | null = null): RotoBrushPropagationVisualResultV1 => ({
  status: "REFUSED",
  propagationVisualVerified: false,
  finalVisualEvidenceId: evidence,
  detail,
  frameSteps: 0,
  aeActionToActionLatenciesMs: [],
});

const exactBinding = (binding: Record<string, unknown> | null, request: RotoBrushPropagationVisualRequestV1): boolean =>
  !!binding
  && binding["operation"] === request.operation
  && binding["compHostId"] === request.compHostId
  && binding["layerHostId"] === request.layerHostId
  && binding["expectedCompName"] === request.expectedCompName
  && binding["expectedLayerName"] === request.expectedLayerName
  && binding["expectedSessionRevision"] === request.expectedSessionRevision
  && binding["expectedEffectFingerprint"] === request.expectedEffectFingerprint
  && binding["expectedEffectMatchCount"] === request.expectedEffectMatchCount;
const exactRangeBinding = (binding: Record<string, unknown> | null, request: RotoBrushPropagationVisualRequestV1): boolean =>
  exactBinding(binding, request)
  && JSON.stringify(binding?.["range"]) === JSON.stringify(request.range)
  && binding?.["frameDuration"] === request.frameDuration
  && binding?.["expectedFrameSteps"] === request.expectedFrameSteps
  && binding?.["expectedStartTime"] === request.expectedStartTime
  && binding?.["expectedEndTime"] === request.expectedEndTime
  && JSON.stringify(binding?.["evidenceIds"]) === JSON.stringify(request.evidenceIds);

const parseResult = (raw: string, request: RotoBrushPropagationVisualRequestV1): RotoBrushPropagationVisualResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return refuse("EditGPT Roto Brush propagation sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return refuse("EditGPT Roto Brush propagation sidecar returned a non-object result.");
  const evidence = typeof root["finalVisualEvidenceId"] === "string" ? String(root["finalVisualEvidenceId"]) : null;
  const latencies = cleanLatencies(root["aeActionToActionLatenciesMs"]);
  if (root["status"] !== "COMPLETED") {
    return { ...refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT Roto Brush propagation sidecar refused the action.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  if (!exactRangeBinding(record(root["targetBinding"]), request)) {
    return { ...refuse("EditGPT Roto Brush propagation sidecar target correlation mismatch.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  if (root["propagationVisualVerified"] !== true || root["frameSteps"] !== request.expectedFrameSteps || !evidence) {
    return { ...refuse("EditGPT Roto Brush propagation sidecar did not retain verified propagation evidence.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  return {
    status: "COMPLETED",
    propagationVisualVerified: true,
    finalVisualEvidenceId: evidence,
    detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Verified bounded Roto Brush propagation completed.",
    frameSteps: request.expectedFrameSteps,
    aeActionToActionLatenciesMs: latencies,
  };
};

export class EditGptRotoBrushPropagationVisualDriverV1 implements RotoBrushPropagationVisualDriverV1 {
  readonly driverId = "editgpt.eyes-hands.roto-brush-propagation.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportedDirections = Object.freeze(["PROPAGATE_FORWARD", "PROPAGATE_BACKWARD"] as const);
  readonly config: Required<Omit<EditGptRotoBrushPropagationVisualDriverConfigV1, "evidenceDirectory">> & {
    readonly evidenceDirectory: string | null;
  };
  readonly runner: TrackerVisualSidecarRunnerV1;

  constructor(
    config: EditGptRotoBrushPropagationVisualDriverConfigV1,
    runner: TrackerVisualSidecarRunnerV1 = new NodeTrackerVisualSidecarRunnerV1(),
  ) {
    assertAbsolute("executablePath", config.executablePath);
    assertAbsolute("scriptPath", config.scriptPath);
    assertAbsolute("workingDirectory", config.workingDirectory);
    if (config.evidenceDirectory) assertAbsolute("evidenceDirectory", config.evidenceDirectory);
    const timeoutMs = config.timeoutMs ?? 120000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
      throw new RangeError("timeoutMs must be between 1000 and 300000 milliseconds.");
    }
    this.config = { ...config, evidenceDirectory: config.evidenceDirectory ?? null, timeoutMs };
    this.runner = runner;
  }

  async propagate(input: RotoBrushPropagationVisualRequestV1): Promise<RotoBrushPropagationVisualResultV1> {
    if (!this.supportedDirections.includes(input.operation)) return refuse("Roto Brush propagation direction is not proven.");
    if (!input.expectedSessionRevision || !input.expectedEffectFingerprint || input.expectedEffectMatchCount !== 1 || input.evidenceIds.length === 0) {
      return refuse("Roto Brush propagation request is missing an exact session/effect/evidence guard.");
    }
    if (!Number.isInteger(input.expectedFrameSteps) || input.expectedFrameSteps < 1 || input.expectedFrameSteps > 12) {
      return refuse("Roto Brush propagation request exceeds the bounded frame-step proof budget.");
    }
    const payload = JSON.stringify({
      schema: "editflow.roto-brush-propagation.visual.v1",
      operation: input.operation,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: input.expectedSessionRevision,
      expectedEffectFingerprint: input.expectedEffectFingerprint,
      expectedEffectMatchCount: input.expectedEffectMatchCount,
      range: input.range,
      frameDuration: input.frameDuration,
      expectedFrameSteps: input.expectedFrameSteps,
      expectedStartTime: input.expectedStartTime,
      expectedEndTime: input.expectedEndTime,
      evidenceIds: input.evidenceIds,
    });
    const args = [this.config.scriptPath, "--request-json", payload];
    if (this.config.evidenceDirectory) args.push("--evidence-dir", this.config.evidenceDirectory);
    let result: TrackerVisualSidecarProcessResultV1;
    try {
      result = await this.runner.run({
        executablePath: this.config.executablePath,
        args,
        workingDirectory: this.config.workingDirectory,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      return refuse(`EditGPT Roto Brush propagation sidecar failed to launch: ${String(error)}`);
    }
    if (result.timedOut) return refuse("EditGPT Roto Brush propagation sidecar timed out.");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      return refuse(`EditGPT Roto Brush propagation sidecar failed: ${detail}`);
    }
    return parseResult(result.stdout, input);
  }
}
