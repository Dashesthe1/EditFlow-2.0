import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error("Missing required argument " + name);
  return argv[index + 1];
};
const family = value("--family").trim().toUpperCase();
const evidencePath = path.resolve(value("--evidence"));
const admissionPath = path.resolve(value("--admission"));
const outputPath = path.resolve(value("--output"));
const stem = value("--stem");
const materializerPath = path.join(ROOT, "scripts", "proofs", "m6-generic-native-materializer-proof.mjs");
const correctionPath = path.join(ROOT, "scripts", "proofs", "m6-generic-native-auto-correction-proof.mjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = async (file) => sha256(await readFile(file));
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const readLiveState = async () => {
  const response = await fetch(CONTROL + "/state");
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error("Live AE state read failed: " + JSON.stringify(body));
  }
  return body;
};

const admission = await load(admissionPath);
if (admission.schema !== "editflow.m6.reference-family-admission-proof.v1"
  || admission.result !== "REJECTED"
  || admission.requestedFamily !== family) {
  throw new Error("Live rejection proof requires a retained REJECTED family-admission artifact.");
}
if (admission.sourceEvidence?.ref !== relative(evidencePath)) {
  throw new Error("Admission source evidence does not match the requested live-boundary evidence.");
}

const before = await readLiveState();
const spawnRunner = (script, args) => spawnSync(process.execPath, [script, ...args], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 8 * 1024 * 1024,
});
const materializer = spawnRunner(materializerPath, [
  "--family", family,
  "--evidence", relative(evidencePath),
  "--stem", stem + "-materializer",
]);
const correction = spawnRunner(correctionPath, [
  "--family", family,
  "--reference", relative(evidencePath),
  "--seed", relative(evidencePath),
  "--stem", stem + "-correction",
]);
const after = await readLiveState();
const expectedFailure = "Reference evidence failed " + family + " family admission:";
const materializerOutput = [materializer.stdout, materializer.stderr].filter(Boolean).join("\n");
const correctionOutput = [correction.stdout, correction.stderr].filter(Boolean).join("\n");
if (materializer.status === 0 || !materializerOutput.includes(expectedFailure)) {
  throw new Error("Materializer did not fail at the expected family-admission boundary: " + materializerOutput);
}
if (correction.status === 0 || !correctionOutput.includes(expectedFailure)) {
  throw new Error("Correction runner did not fail at the expected family-admission boundary: " + correctionOutput);
}
if (before.hostRevision !== after.hostRevision
  || before.state?.observed?.projectFingerprint !== after.state?.observed?.projectFingerprint) {
  throw new Error("Rejected family evidence changed live AE state.");
}
if (before.mutationLease?.held || after.mutationLease?.held) {
  throw new Error("Rejected family evidence acquired or leaked an AE mutation lease.");
}

const artifact = {
  schema: "editflow.m6.known-family-rejection-live-boundary-proof.v1",
  status: "PASS",
  authority: "LIVE_AE_FAIL_CLOSED_BEFORE_MUTATION",
  family,
  sourceAdmission: {
    ref: relative(admissionPath),
    sha256: await sha256File(admissionPath),
    definingCoverage: admission.candidate.definingCoverage,
    failedInvariantIds: admission.candidate.checks.filter((item) => !item.passed)
      .map((item) => item.invariantId),
  },
  materializer: {
    ref: relative(materializerPath),
    sha256: await sha256File(materializerPath),
    exitCode: materializer.status,
    expectedFailure,
  },
  correction: {
    ref: relative(correctionPath),
    sha256: await sha256File(correctionPath),
    exitCode: correction.status,
    expectedFailure,
  },
  liveAe: {
    hostName: before.state?.environment?.hostName ?? null,
    hostVersion: before.state?.environment?.hostVersion ?? null,
    protocolVersion: before.panel?.protocolVersion ?? null,
    beforeHostRevision: before.hostRevision,
    afterHostRevision: after.hostRevision,
    projectFingerprint: before.state?.observed?.projectFingerprint ?? null,
    beforeMutationLeaseHeld: before.mutationLease?.held ?? null,
    afterMutationLeaseHeld: after.mutationLease?.held ?? null,
  },
  noOverclaim: "This proves rejected family evidence is blocked before AE mutation. It is not a fidelity pass.",
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  family,
  status: artifact.status,
  hostRevision: artifact.liveAe.afterHostRevision,
}));
