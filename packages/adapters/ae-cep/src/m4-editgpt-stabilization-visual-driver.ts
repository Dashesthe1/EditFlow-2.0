import path from "node:path";
import {
  NodeTrackerVisualSidecarRunnerV1,
  type TrackerVisualSidecarProcessResultV1,
  type TrackerVisualSidecarRunnerV1,
} from "./m4-editgpt-tracker-visual-driver.js";
import type {
  StabilizationVisualDriverV1,
  StabilizationVisualRequestV1,
  StabilizationVisualResultV1,
} from "./m4-stabilization.js";

export interface EditGptStabilizationVisualDriverConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly evidenceDirectory?: string | null;
  readonly timeoutMs?: number;
  readonly analysisWindowSeconds?: number;
}
const absolute = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const assertAbsolute = (name: string, value: string): void => { if (!value || !absolute(value)) throw new TypeError(`${name} must be a non-empty absolute path.`); };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const refuse = (detail: string, visualEvidenceId: string | null = null): StabilizationVisualResultV1 => ({ status: "REFUSED", visualEvidenceId, detail });
const parseResult = (raw: string, request: StabilizationVisualRequestV1): StabilizationVisualResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return refuse("EditGPT stabilization sidecar returned malformed JSON."); }
  const root = record(parsed); if (!root) return refuse("EditGPT stabilization sidecar returned a non-object result.");
  const evidence = typeof root["visualEvidenceId"] === "string" ? String(root["visualEvidenceId"]) : null;
  if (root["status"] !== "COMPLETED") return refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT stabilization sidecar refused the action.", evidence);
  const binding = record(root["targetBinding"]);
  if (!binding
    || binding["direction"] !== request.direction
    || binding["expectedControl"] !== request.expectedControl
    || binding["compHostId"] !== request.compHostId
    || binding["layerHostId"] !== request.layerHostId
    || binding["expectedCompName"] !== request.expectedCompName
    || binding["expectedLayerName"] !== request.expectedLayerName) {
    return refuse("EditGPT stabilization sidecar target correlation mismatch.", evidence);
  }
  if (root["guardedVisualTargetVerified"] !== true || !evidence) return refuse("EditGPT stabilization sidecar did not retain verified target evidence.", evidence);
  return { status: "COMPLETED", visualEvidenceId: evidence, detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Guarded native position stabilization completed." };
};

export class EditGptStabilizationVisualDriverV1 implements StabilizationVisualDriverV1 {
  readonly driverId = "editgpt.eyes-hands.stabilization.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportedDirections = Object.freeze(["FORWARD"] as const);
  readonly config: Required<Omit<EditGptStabilizationVisualDriverConfigV1, "evidenceDirectory">> & { readonly evidenceDirectory: string | null };
  readonly runner: TrackerVisualSidecarRunnerV1;
  constructor(config: EditGptStabilizationVisualDriverConfigV1, runner: TrackerVisualSidecarRunnerV1 = new NodeTrackerVisualSidecarRunnerV1()) {
    assertAbsolute("executablePath", config.executablePath); assertAbsolute("scriptPath", config.scriptPath); assertAbsolute("workingDirectory", config.workingDirectory);
    if (config.evidenceDirectory) assertAbsolute("evidenceDirectory", config.evidenceDirectory);
    const timeoutMs = config.timeoutMs ?? 120000; if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new RangeError("timeoutMs must be between 1000 and 300000 milliseconds.");
    const analysisWindowSeconds = config.analysisWindowSeconds ?? 4; if (!Number.isFinite(analysisWindowSeconds) || analysisWindowSeconds < 1 || analysisWindowSeconds > 30) throw new RangeError("analysisWindowSeconds must be between 1 and 30 seconds.");
    this.config = { ...config, evidenceDirectory: config.evidenceDirectory ?? null, timeoutMs, analysisWindowSeconds };
    this.runner = runner;
  }
  async stabilize(input: StabilizationVisualRequestV1): Promise<StabilizationVisualResultV1> {
    if (input.direction !== "FORWARD" || input.expectedControl !== "STABILIZE_ANALYZE_APPLY_FORWARD") return refuse("Only retained native Stabilize Motion Analyze Forward + Apply evidence is currently registered.");
    if (!Number.isInteger(input.compHostId) || input.compHostId <= 0 || !Number.isInteger(input.layerHostId) || input.layerHostId <= 0 || !input.expectedCompName || !input.expectedLayerName) return refuse("Stabilization visual request is missing an exact typed target binding.");
    const payload = JSON.stringify({ schema: "editflow.stabilization.visual.v1", direction: input.direction, expectedControl: input.expectedControl, compHostId: input.compHostId, layerHostId: input.layerHostId, expectedCompName: input.expectedCompName, expectedLayerName: input.expectedLayerName });
    const args = [this.config.scriptPath, "--request-json", payload];
    if (this.config.evidenceDirectory) args.push("--evidence-dir", this.config.evidenceDirectory);
    args.push("--analysis-window-seconds", String(this.config.analysisWindowSeconds));
    let result: TrackerVisualSidecarProcessResultV1;
    try { result = await this.runner.run({ executablePath: this.config.executablePath, args, workingDirectory: this.config.workingDirectory, timeoutMs: this.config.timeoutMs }); }
    catch (error) { return refuse(`EditGPT stabilization sidecar failed to launch: ${String(error)}`); }
    if (result.timedOut) return refuse("EditGPT stabilization sidecar timed out.");
    if (result.exitCode !== 0) return refuse(`EditGPT stabilization sidecar failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`}`);
    return parseResult(result.stdout, input);
  }
}
