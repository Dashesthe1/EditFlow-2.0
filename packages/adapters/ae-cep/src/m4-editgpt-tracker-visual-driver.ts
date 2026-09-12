import { spawn } from "node:child_process";
import path from "node:path";

import type {
  TrackerVisualAnalysisDriverV1,
  TrackerVisualAnalysisRequestV1,
  TrackerVisualAnalysisResultV1,
} from "./m4-tracker-analysis.js";

export interface TrackerVisualSidecarInvocationV1 {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly timeoutMs: number;
}

export interface TrackerVisualSidecarProcessResultV1 {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface TrackerVisualSidecarRunnerV1 {
  run(input: TrackerVisualSidecarInvocationV1): Promise<TrackerVisualSidecarProcessResultV1>;
}
export interface EditGptTrackerVisualDriverConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly evidenceDirectory?: string | null;
  readonly timeoutMs?: number;
  readonly analysisWindowSeconds?: number;
}

const isAbsolutePath = (value: string): boolean =>
  path.isAbsolute(value) || path.win32.isAbsolute(value);

const assertAbsolutePath = (name: string, value: string): void => {
  if (!value || !isAbsolutePath(value)) {
    throw new TypeError(`${name} must be a non-empty absolute path.`);
  }
};

const appendBounded = (current: string, chunk: Buffer | string, limit = 1024 * 1024): string => {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") > limit) {
    throw new Error("TRACKER_VISUAL_SIDECAR_OUTPUT_LIMIT_EXCEEDED");
  }
  return next;
};

export class NodeTrackerVisualSidecarRunnerV1 implements TrackerVisualSidecarRunnerV1 {
  async run(input: TrackerVisualSidecarInvocationV1): Promise<TrackerVisualSidecarProcessResultV1> {
    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn(input.executablePath, [...input.args], {
        cwd: input.workingDirectory,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);
      child.stdout.on("data", (chunk) => {
        try { stdout = appendBounded(stdout, chunk); }
        catch (error) { clearTimeout(timer); child.kill(); reject(error); }
      });
      child.stderr.on("data", (chunk) => {
        try { stderr = appendBounded(stderr, chunk); }
        catch (error) { clearTimeout(timer); child.kill(); reject(error); }
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ exitCode: code, signal, stdout, stderr, timedOut });
      });
    });
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const refuse = (detail: string, visualEvidenceId: string | null = null): TrackerVisualAnalysisResultV1 => ({
  status: "REFUSED",
  visualEvidenceId,
  detail,
});

const parseSidecarResult = (
  raw: string,
  request: TrackerVisualAnalysisRequestV1,
): TrackerVisualAnalysisResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return refuse("EditGPT tracker visual sidecar returned malformed JSON."); }
  const root = asRecord(parsed);
  if (!root) return refuse("EditGPT tracker visual sidecar returned a non-object result.");
  const evidence = typeof root["visualEvidenceId"] === "string" ? String(root["visualEvidenceId"]) : null;
  if (root["status"] !== "COMPLETED") {
    return refuse(typeof root["detail"] === "string" ? String(root["detail"]) : "EditGPT tracker visual sidecar refused the action.", evidence);
  }
  const binding = asRecord(root["targetBinding"]);
  if (!binding
    || binding["direction"] !== request.direction
    || binding["expectedControl"] !== request.expectedControl
    || binding["compHostId"] !== request.compHostId
    || binding["layerHostId"] !== request.layerHostId
    || binding["expectedCompName"] !== request.expectedCompName
    || binding["expectedLayerName"] !== request.expectedLayerName
    || binding["expectedTrackerName"] !== request.expectedTrackerName) {
    return refuse("EditGPT tracker visual sidecar target correlation mismatch.", evidence);
  }
  if (root["guardedVisualTargetVerified"] !== true || !evidence) {
    return refuse("EditGPT tracker visual sidecar did not retain verified visual target evidence.", evidence);
  }
  return {
    status: "COMPLETED",
    visualEvidenceId: evidence,
    detail: typeof root["detail"] === "string" ? String(root["detail"]) : "Verified EditGPT Tracker visual action completed.",
  };
};

export class EditGptTrackerVisualDriverV1 implements TrackerVisualAnalysisDriverV1 {
  readonly driverId = "editgpt.eyes-hands.tracker.v1";
  readonly verifiedVision = true;
  readonly verifiedCursorControl = true;
  readonly supportedDirections = Object.freeze(["FORWARD", "BACKWARD"] as const);
  readonly config: Required<Omit<EditGptTrackerVisualDriverConfigV1, "evidenceDirectory">> & {
    readonly evidenceDirectory: string | null;
  };
  readonly runner: TrackerVisualSidecarRunnerV1;

  constructor(
    config: EditGptTrackerVisualDriverConfigV1,
    runner: TrackerVisualSidecarRunnerV1 = new NodeTrackerVisualSidecarRunnerV1(),
  ) {
    assertAbsolutePath("executablePath", config.executablePath);
    assertAbsolutePath("scriptPath", config.scriptPath);
    assertAbsolutePath("workingDirectory", config.workingDirectory);
    if (config.evidenceDirectory) assertAbsolutePath("evidenceDirectory", config.evidenceDirectory);
    const timeoutMs = config.timeoutMs ?? 120000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
      throw new RangeError("timeoutMs must be between 1000 and 300000 milliseconds.");
    }
    const analysisWindowSeconds = config.analysisWindowSeconds ?? 5;
    if (!Number.isFinite(analysisWindowSeconds) || analysisWindowSeconds < 1 || analysisWindowSeconds > 30) {
      throw new RangeError("analysisWindowSeconds must be between 1 and 30 seconds.");
    }
    this.config = {
      executablePath: config.executablePath,
      scriptPath: config.scriptPath,
      workingDirectory: config.workingDirectory,
      evidenceDirectory: config.evidenceDirectory ?? null,
      timeoutMs,
      analysisWindowSeconds,
    };
    this.runner = runner;
  }

  async analyze(input: TrackerVisualAnalysisRequestV1): Promise<TrackerVisualAnalysisResultV1> {
    const expectedControl = input.direction === "FORWARD" ? "TRACKER_ANALYZE_FORWARD" : "TRACKER_ANALYZE_BACKWARD";
    if (!this.supportedDirections.includes(input.direction) || input.expectedControl !== expectedControl) {
      return refuse("Analyze direction/control pair is not covered by the retained real-AE visual proofs.");
    }
    if (!Number.isInteger(input.compHostId) || input.compHostId <= 0
      || !Number.isInteger(input.layerHostId) || input.layerHostId <= 0
      || !input.expectedCompName || !input.expectedLayerName || !input.expectedTrackerName) {
      return refuse("Tracker visual request is missing an exact typed target binding.");
    }
    const payload = JSON.stringify({
      schema: "editflow.tracker.visual.v1",
      direction: input.direction,
      expectedControl: input.expectedControl,
      trackerIndex: input.trackerIndex,
      pointIndex: input.pointIndex,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedTrackerName: input.expectedTrackerName,
    });
    const args = [this.config.scriptPath, "--request-json", payload];
    if (this.config.evidenceDirectory) args.push("--evidence-dir", this.config.evidenceDirectory);
    args.push("--analysis-window-seconds", String(this.config.analysisWindowSeconds));
    let result: TrackerVisualSidecarProcessResultV1;
    try {
      result = await this.runner.run({
        executablePath: this.config.executablePath,
        args,
        workingDirectory: this.config.workingDirectory,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      return refuse(`EditGPT tracker visual sidecar failed to launch: ${String(error)}`);
    }
    if (result.timedOut) return refuse("EditGPT tracker visual sidecar timed out.");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      return refuse(`EditGPT tracker visual sidecar failed: ${detail}`);
    }
    return parseSidecarResult(result.stdout, input);
  }
}
