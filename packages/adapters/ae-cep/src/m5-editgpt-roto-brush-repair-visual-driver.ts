import path from "node:path";

import {
  NodeTrackerVisualSidecarRunnerV1,
  type TrackerVisualSidecarProcessResultV1,
  type TrackerVisualSidecarRunnerV1,
} from "./m4-editgpt-tracker-visual-driver.js";
import type {
  RotoBrushRepairVisualDriverV1,
  RotoBrushRepairVisualRequestV1,
  RotoBrushRepairVisualResultV1,
} from "./m5-roto-brush-repair-controller.js";

export interface EditGptRotoBrushRepairVisualDriverConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly afterFxPath: string;
  readonly toolSelectScriptPath: string;
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
const refuse = (detail: string, visualEvidenceId: string | null = null): RotoBrushRepairVisualResultV1 => ({
  status: "REFUSED",
  visualEvidenceId,
  detail,
  visibleRepairChangeObserved: false,
  aeActionToActionLatenciesMs: [],
});
const cleanLatencies = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) return [];
  const values = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0);
  return values.length === value.length ? Object.freeze([...values]) : [];
};
const exactBinding = (binding: Record<string, unknown> | null, request: RotoBrushRepairVisualRequestV1): boolean =>
  !!binding
  && binding["operation"] === request.operation
  && binding["compHostId"] === request.compHostId
  && binding["layerHostId"] === request.layerHostId
  && binding["expectedCompName"] === request.expectedCompName
  && binding["expectedLayerName"] === request.expectedLayerName
  && binding["expectedSessionRevision"] === request.expectedSessionRevision
  && binding["expectedEffectFingerprint"] === request.expectedEffectFingerprint
  && binding["expectedEffectMatchCount"] === request.expectedEffectMatchCount
  && binding["expectedTool"] === request.expectedTool
  && binding["atTime"] === request.atTime
  && JSON.stringify(binding["stroke"]) === JSON.stringify(request.stroke)
  && JSON.stringify(binding["evidenceIds"]) === JSON.stringify(request.evidenceIds);

const parseResult = (raw: string, request: RotoBrushRepairVisualRequestV1): RotoBrushRepairVisualResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return refuse("EditGPT Roto Brush repair sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return refuse("EditGPT Roto Brush repair sidecar returned a non-object result.");
  const evidence = typeof root["visualEvidenceId"] === "string" ? String(root["visualEvidenceId"]) : null;
  const latencies = cleanLatencies(root["aeActionToActionLatenciesMs"]);
  if (root["status"] !== "COMPLETED") {
    return {
      ...refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT Roto Brush repair sidecar refused the action.", evidence),
      aeActionToActionLatenciesMs: latencies,
    };
  }
  if (!exactBinding(record(root["targetBinding"]), request)) {
    return { ...refuse("EditGPT Roto Brush repair sidecar target correlation mismatch.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  if (root["guardedVisualTargetVerified"] !== true || root["nativeRepairStrokeAttempted"] !== true
    || root["visibleRepairChangeObserved"] !== true || !evidence) {
    return { ...refuse("EditGPT Roto Brush repair sidecar did not retain verified visible repair evidence.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  return {
    status: "COMPLETED",
    visualEvidenceId: evidence,
    detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Verified Roto Brush repair stroke completed.",
    visibleRepairChangeObserved: true,
    aeActionToActionLatenciesMs: latencies,
  };
};

export class EditGptRotoBrushRepairVisualDriverV1 implements RotoBrushRepairVisualDriverV1 {
  readonly driverId = "editgpt.eyes-hands.roto-brush-repair.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportedRoles = Object.freeze(["FOREGROUND", "BACKGROUND"] as const);
  readonly config: Required<Omit<EditGptRotoBrushRepairVisualDriverConfigV1, "evidenceDirectory">> & {
    readonly evidenceDirectory: string | null;
  };
  readonly runner: TrackerVisualSidecarRunnerV1;

  constructor(
    config: EditGptRotoBrushRepairVisualDriverConfigV1,
    runner: TrackerVisualSidecarRunnerV1 = new NodeTrackerVisualSidecarRunnerV1(),
  ) {
    assertAbsolute("executablePath", config.executablePath);
    assertAbsolute("scriptPath", config.scriptPath);
    assertAbsolute("workingDirectory", config.workingDirectory);
    assertAbsolute("afterFxPath", config.afterFxPath);
    assertAbsolute("toolSelectScriptPath", config.toolSelectScriptPath);
    if (config.evidenceDirectory) assertAbsolute("evidenceDirectory", config.evidenceDirectory);
    const timeoutMs = config.timeoutMs ?? 120000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
      throw new RangeError("timeoutMs must be between 1000 and 300000 milliseconds.");
    }
    this.config = { ...config, evidenceDirectory: config.evidenceDirectory ?? null, timeoutMs };
    this.runner = runner;
  }

  async repair(input: RotoBrushRepairVisualRequestV1): Promise<RotoBrushRepairVisualResultV1> {
    if (input.operation !== "REPAIR_STROKE" || !this.supportedRoles.includes(input.stroke.role)) {
      return refuse("Roto Brush repair requires a proven FOREGROUND or BACKGROUND correction role.");
    }
    if (input.expectedTool !== "ROTO_BRUSH" || input.expectedEffectMatchCount !== 1
      || !input.expectedSessionRevision || !input.expectedEffectFingerprint || input.evidenceIds.length === 0) {
      return refuse("Roto Brush repair request is missing exact tool, effect, revision, or retained evidence guards.");
    }
    const payload = JSON.stringify({
      schema: "editflow.roto-brush-repair.visual.v1",
      operation: input.operation,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: input.expectedSessionRevision,
      expectedEffectFingerprint: input.expectedEffectFingerprint,
      expectedEffectMatchCount: input.expectedEffectMatchCount,
      atTime: input.atTime,
      stroke: input.stroke,
      expectedTool: input.expectedTool,
      evidenceIds: input.evidenceIds,
    });
    const args = [this.config.scriptPath, "--request-json", payload,
      "--afterfx-path", this.config.afterFxPath,
      "--tool-select-script", this.config.toolSelectScriptPath];
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
      return refuse(`EditGPT Roto Brush repair sidecar failed to launch: ${String(error)}`);
    }
    if (result.timedOut) return refuse("EditGPT Roto Brush repair sidecar timed out.");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      return refuse(`EditGPT Roto Brush repair sidecar failed: ${detail}`);
    }
    return parseResult(result.stdout, input);
  }
}