import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = "C:\\Users\\Shadow\\EditFlow-2.0";
const read = async (relative) => JSON.parse(await readFile(`${root}\\${relative}`, "utf8"));
const setup = await read("proofs\\artifacts\\m4-tracker-repair-resume-fixture.json");
const visual = await read("proofs\\artifacts\\m4-tracker-repair-resume-visual\\result.json");
const readback = await read("proofs\\artifacts\\m4-tracker-repair-resume-readback.json");
const cleanup = await read("proofs\\artifacts\\m4-tracker-repair-resume-cleanup.json");
const repair = setup.repairResponse;
const completion = visual?.proof?.completion;
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
  proof: "M4_TRACKER_REPAIR_RESUME_FORWARD_LIVE_ACCEPTANCE",
  accepted,
  protocol: { repair: "2.4.0", verification: "2.1.0" },
  checks,
  target: { compName: setup.compName, layerName: setup.layerName, trackerName: setup.trackerName, pointIndex: setup.pointIndex },
  repair: { time: setup.repairTime, desiredFeatureCenter: setup.desiredRepairCenter, hostDurationMs: repair?.diagnostics?.durationMs ?? null },
  resume: {
    direction: visual?.targetBinding?.direction ?? null,
    visualEvidenceId: visual?.visualEvidenceId ?? null,
    activeStopObserved: completion?.activeStopObserved ?? false,
    stopClicked: completion?.stopClicked ?? false,
    preResumeKeyCount: readback.preResumeFeatureCenterKeyCount,
    postResumeKeyCount: readback.postResumeKeyedSampleCount,
    postRepairSampleCount: readback.postRepairSampleCount,
    groundTruthErrorPx: readback.groundTruthErrorPx,
    firstPostRepairSample: readback.firstPostRepairSamples?.[0] ?? null,
  },
  cleanup,
  limitations: ["Analyze Forward only", "Feature Center repair only", "Automatic drift detection and mask repair remain unproven"],
};
await mkdir(`${root}\\proofs\\diagnostics`, { recursive: true });
await writeFile(`${root}\\proofs\\diagnostics\\m4-tracker-repair-resume-forward-live-acceptance.json`, JSON.stringify(acceptance, null, 2), "utf8");
console.log(JSON.stringify(acceptance));
process.exitCode = accepted ? 0 : 2;
