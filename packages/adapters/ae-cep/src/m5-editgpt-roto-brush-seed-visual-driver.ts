import path from "node:path";

import {
  NodeTrackerVisualSidecarRunnerV1,
  type TrackerVisualSidecarProcessResultV1,
  type TrackerVisualSidecarRunnerV1,
} from "./m4-editgpt-tracker-visual-driver.js";
import type {
  RotoBrushSeedVisualDriverV1,
  RotoBrushSeedVisualRequestV1,
  RotoBrushSeedVisualResultV1,
} from "./m5-roto-brush-seed-controller.js";

export interface EditGptRotoBrushSeedVisualDriverConfigV1 {
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
const refuse = (detail: string, visualEvidenceId: string | null = null): RotoBrushSeedVisualResultV1 => ({
  status: "REFUSED",
  visualEvidenceId,
  detail,
  aeActionToActionLatenciesMs: [],
});
const cleanLatencies = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) return [];
  const values = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0);
  return values.length === value.length ? Object.freeze([...values]) : [];
};
const exactBinding = (binding: Record<string, unknown> | null, request: RotoBrushSeedVisualRequestV1): boolean =>
  !!binding
  && binding["operation"] === request.operation
  && binding["compHostId"] === request.compHostId
  && binding["layerHostId"] === request.layerHostId
  && binding["expectedCompName"] === request.expectedCompName
  && binding["expectedLayerName"] === request.expectedLayerName
  && binding["expectedSessionRevision"] === request.expectedSessionRevision
  && binding["expectedEffectMatchCount"] === request.expectedEffectMatchCount
  && binding["expectedTool"] === request.expectedTool
  && binding["atTime"] === request.atTime
  && JSON.stringify(binding["stroke"]) === JSON.stringify(request.stroke)
  && JSON.stringify(binding["evidenceIds"]) === JSON.stringify(request.evidenceIds);

const parseResult = (raw: string, request: RotoBrushSeedVisualRequestV1): RotoBrushSeedVisualResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return refuse("EditGPT Roto Brush seed sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return refuse("EditGPT Roto Brush seed sidecar returned a non-object result.");
  const evidence = typeof root["visualEvidenceId"] === "string" ? String(root["visualEvidenceId"]) : null;
  const latencies = cleanLatencies(root["aeActionToActionLatenciesMs"]);
  if (root["status"] !== "COMPLETED") {
    return {
      ...refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT Roto Brush seed sidecar refused the action.", evidence),
      aeActionToActionLatenciesMs: latencies,
    };
  }
  if (!exactBinding(record(root["targetBinding"]), request)) {
    return { ...refuse("EditGPT Roto Brush seed sidecar target correlation mismatch.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  if (root["guardedVisualTargetVerified"] !== true || root["nativeStrokeAttempted"] !== true || !evidence) {
    return { ...refuse("EditGPT Roto Brush seed sidecar did not retain verified stroke evidence.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  return {
    status: "COMPLETED",
    visualEvidenceId: evidence,
    detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Verified Roto Brush foreground seed stroke completed.",
    aeActionToActionLatenciesMs: latencies,
  };
};

export class EditGptRotoBrushSeedVisualDriverV1 implements RotoBrushSeedVisualDriverV1 {
  readonly driverId = "editgpt.eyes-hands.roto-brush-seed.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportedRoles = Object.freeze(["FOREGROUND"] as const);
  readonly config: Required<Omit<EditGptRotoBrushSeedVisualDriverConfigV1, "evidenceDirectory">> & {
    readonly evidenceDirectory: string | null;
  };
  readonly runner: TrackerVisualSidecarRunnerV1;

  constructor(
    config: EditGptRotoBrushSeedVisualDriverConfigV1,
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

  async seed(input: RotoBrushSeedVisualRequestV1): Promise<RotoBrushSeedVisualResultV1> {
    if (input.operation !== "SEED_FOREGROUND" || input.stroke.role !== "FOREGROUND") {
      return refuse("Only foreground Roto Brush seed strokes are proven for this visual driver tranche.");
    }
    if (input.expectedTool !== "ROTO_BRUSH" || !input.expectedSessionRevision || input.evidenceIds.length === 0) {
      return refuse("Roto Brush seed request is missing the exact tool, revision, or retained evidence guard.");
    }
    const payload = JSON.stringify({
      schema: "editflow.roto-brush-seed.visual.v1",
      operation: input.operation,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: input.expectedSessionRevision,
      expectedEffectMatchCount: input.expectedEffectMatchCount,
      atTime: input.atTime,
      stroke: input.stroke,
      expectedTool: input.expectedTool,
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
      return refuse(`EditGPT Roto Brush seed sidecar failed to launch: ${String(error)}`);
    }
    if (result.timedOut) return refuse("EditGPT Roto Brush seed sidecar timed out.");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      return refuse(`EditGPT Roto Brush seed sidecar failed: ${detail}`);
    }
    return parseResult(result.stdout, input);
  }
}
