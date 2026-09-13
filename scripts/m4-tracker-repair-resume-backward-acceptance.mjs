import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (...parts) => JSON.parse(await readFile(path.join(root, ...parts), "utf8"));
const setup = await read("proofs", "artifacts", "m4-tracker-repair-resume-backward-fixture.json");
const visual = await read("proofs", "artifacts", "m4-tracker-repair-resume-backward-visual", "result.json");
const readback = await read("proofs", "artifacts", "m4-tracker-repair-resume-backward-readback.json");
const cleanup = await read("proofs", "artifacts", "m4-tracker-repair-resume-backward-cleanup.json");
const repair = setup.repairResponse;
const completion = visual?.proof?.completion;
const normalizeEvidenceId = (value) => {
  if (typeof value !== "string" || !value) return null;
  return path.isAbsolute(value) ? path.relative(root, value).split(path.sep).join("/") : value;
};
const checks = {
  repairApplied: repair?.outcome === "APPLIED",
  repairReadbackExact: repair?.readback?.featureCenter?.exactKeyAtTime === true
    && repair?.readback?.featureCenter?.valueAtTime?.[0] === setup.desiredRepairCenter[0]
    && repair?.readback?.featureCenter?.valueAtTime?.[1] === setup.desiredRepairCenter[1],
  visualResumeCompleted: visual?.status === "COMPLETED" && visual?.guardedVisualTargetVerified === true,
  activeStopObserved: completion?.activeStopObserved === true,
  postResumeReadbackAccepted: readback?.ok === true,
  cleanupRestoredBaseline: cleanup?.ok === true,
};
const accepted = Object.values(checks).every(Boolean);
const acceptance = {
  proof: "M4_TRACKER_REPAIR_RESUME_BACKWARD_LIVE_ACCEPTANCE",
  accepted,
  protocol: { repair: "2.4.0", verification: "2.1.0" },
  checks,
  target: { compName: setup.compName, layerName: setup.layerName, trackerName: setup.trackerName, pointIndex: setup.pointIndex },
  repair: { time: setup.repairTime, desiredFeatureCenter: setup.desiredRepairCenter, hostDurationMs: repair?.diagnostics?.durationMs ?? null },
  resume: {
    direction: visual?.targetBinding?.direction ?? null,
    visualEvidenceId: normalizeEvidenceId(visual?.visualEvidenceId),
    activeStopObserved: completion?.activeStopObserved ?? false,
    stopClicked: completion?.stopClicked ?? false,
    preResumeKeyCount: readback.preResumeFeatureCenterKeyCount,
    postResumeKeyCount: readback.postResumeKeyedSampleCount,
    preRepairSampleCount: readback.preRepairSampleCount,
    groundTruthErrorPx: readback.groundTruthErrorPx,
    nearestPreRepairSample: readback.nearestPreRepairSample ?? null,
  },
  cleanup,
  limitations: ["Analyze Backward direction only", "Feature Center repair only", "Automatic drift detection and mask repair remain unproven"],
};
const diagnosticsDir = path.join(root, "proofs", "diagnostics");
await mkdir(diagnosticsDir, { recursive: true });
await writeFile(path.join(diagnosticsDir, "m4-tracker-repair-resume-backward-live-acceptance.json"), JSON.stringify(acceptance, null, 2), "utf8");
console.log(JSON.stringify(acceptance));
process.exitCode = accepted ? 0 : 2;
