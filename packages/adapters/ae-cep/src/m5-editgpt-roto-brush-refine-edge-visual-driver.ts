import path from "node:path";

import {
  NodeTrackerVisualSidecarRunnerV1,
  type TrackerVisualSidecarProcessResultV1,
  type TrackerVisualSidecarRunnerV1,
} from "./m4-editgpt-tracker-visual-driver.js";
import type {
  RotoBrushRefineEdgeVisualDriverV1,
  RotoBrushRefineEdgeVisualRequestV1,
  RotoBrushRefineEdgeVisualResultV1,
} from "./m5-roto-brush-refine-edge-controller.js";

export interface EditGptRotoBrushRefineEdgeVisualDriverConfigV1 {
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
const refuse = (detail: string, visualEvidenceId: string | null = null): RotoBrushRefineEdgeVisualResultV1 => ({
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
const exactBinding = (binding: Record<string, unknown> | null, request: RotoBrushRefineEdgeVisualRequestV1): boolean =>
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

const parseResult = (raw: string, request: RotoBrushRefineEdgeVisualRequestV1): RotoBrushRefineEdgeVisualResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return refuse("EditGPT Refine Edge sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return refuse("EditGPT Refine Edge sidecar returned a non-object result.");
  const evidence = typeof root["visualEvidenceId"] === "string" ? String(root["visualEvidenceId"]) : null;
  const latencies = cleanLatencies(root["aeActionToActionLatenciesMs"]);
  if (root["status"] !== "COMPLETED") {
    return {
      ...refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT Refine Edge sidecar refused the action.", evidence),
      aeActionToActionLatenciesMs: latencies,
    };
  }
  if (!exactBinding(record(root["targetBinding"]), request)) {
    return { ...refuse("EditGPT Refine Edge sidecar target correlation mismatch.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  if (root["guardedVisualTargetVerified"] !== true || root["nativeStrokeAttempted"] !== true || !evidence) {
    return { ...refuse("EditGPT Refine Edge sidecar did not retain verified stroke evidence.", evidence), aeActionToActionLatenciesMs: latencies };
  }
  return {
    status: "COMPLETED",
    visualEvidenceId: evidence,
    detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Verified Refine Edge stroke completed.",
    aeActionToActionLatenciesMs: latencies,
  };
};

export class EditGptRotoBrushRefineEdgeVisualDriverV1 implements RotoBrushRefineEdgeVisualDriverV1 {
  readonly driverId = "editgpt.eyes-hands.roto-brush-refine-edge.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportsRefineEdge = true;
  readonly config: Required<Omit<EditGptRotoBrushRefineEdgeVisualDriverConfigV1, "evidenceDirectory">> & {
    readonly evidenceDirectory: string | null;
  };
  readonly runner: TrackerVisualSidecarRunnerV1;

  constructor(
    config: EditGptRotoBrushRefineEdgeVisualDriverConfigV1,
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

  async refine(input: RotoBrushRefineEdgeVisualRequestV1): Promise<RotoBrushRefineEdgeVisualResultV1> {
    if (input.operation !== "REFINE_EDGE" || input.stroke.role !== "REFINE_EDGE") {
      return refuse("Refine Edge operation and stroke role must both be REFINE_EDGE.");
    }
    if (input.expectedTool !== "REFINE_EDGE" || input.expectedEffectMatchCount !== 1
      || !input.expectedSessionRevision || !input.expectedEffectFingerprint || input.evidenceIds.length === 0) {
      return refuse("Refine Edge request is missing the exact tool, native effect, revision, fingerprint, or evidence guard.");
    }
    const payload = JSON.stringify({
      schema: "editflow.roto-brush-refine-edge.visual.v1",
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
      return refuse(`EditGPT Refine Edge sidecar failed to launch: ${String(error)}`);
    }
    if (result.timedOut) return refuse("EditGPT Refine Edge sidecar timed out.");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      return refuse(`EditGPT Refine Edge sidecar failed: ${detail}`);
    }
    return parseResult(result.stdout, input);
  }
}