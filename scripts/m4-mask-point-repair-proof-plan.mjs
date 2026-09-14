import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { planM4MaskPointRepairV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-mask-point-repair.js";

const artifactDir = process.env.EDITFLOW_PROOF_ARTIFACT_DIR;
if (!artifactDir) throw new Error("EDITFLOW_PROOF_ARTIFACT_DIR is required");
await mkdir(artifactDir, { recursive: true });

const bmp = (width, height, pixel) => {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const buffer = Buffer.alloc(54 + stride * height);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = 54 + (height - 1 - y) * stride + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const width = 240;
const height = 135;
const runId = (process.env.EDITFLOW_PROOF_RUN_ID || String(Date.now())).replace(/[^A-Za-z0-9_-]/g, "_");
const backgroundPath = path.join(artifactDir, `mask-repair-background-${runId}.bmp`);
const foregroundPath = path.join(artifactDir, `mask-repair-foreground-${runId}.bmp`);
await writeFile(backgroundPath, bmp(width, height, () => [18, 48, 102]));
await writeFile(foregroundPath, bmp(width, height, () => [244, 64, 38]));

const wrongShape = {
  closed: true,
  vertices: [[60, 35], [180, 35], [120, 65], [60, 100]],
  inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
  outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]],
};
const expectedShape = {
  ...wrongShape,
  vertices: [[60, 35], [180, 35], [180, 100], [60, 100]],
};
const input = {
  comp: { stableId: "M4_MASK_REPAIR_COMP" },
  layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
  mask: { stableId: "M4_MASK_REPAIR_MASK" },
  path: { kind: "STATIC", shape: wrongShape },
  pointIndex: 2,
  replacement: { vertex: [180, 100] },
  evidenceIds: ["M4_MASK_REPAIR_EXACT_READBACK", "M4_MASK_REPAIR_VISUAL_FAILURE"],
};
const plan = planM4MaskPointRepairV1(input);
if (!plan) throw new Error("Mask-point repair planner failed closed for the deterministic proof fixture");
if (plan.command !== "mask.set_path" || plan.hostCapabilityId !== "ae.mask.path.set") {
  throw new Error("Mask-point repair planner did not bind to the accepted protocol 1.2 path surface");
}

const output = {
  schemaVersion: 1,
  proofId: "M4_MASK_POINT_REPAIR_REAL_AE",
  plan,
  fixture: {
    width,
    height,
    frameRate: 12,
    duration: 1,
    backgroundPath,
    foregroundPath,
    wrongShape,
    expectedShape,
    maskProperties: { mode: "ADD", opacity: 100, expansion: 0, inverted: false },
  },
  visualExpectations: {
    frameTime: 0,
    repairedSample: { x: 165, y: 88 },
    stableInsideSample: { x: 80, y: 60 },
    outsideSample: { x: 30, y: 20 },
    foreground: { rMin: 220, gMax: 100, bMax: 80 },
    background: { rMax: 60, gMin: 20, gMax: 90, bMin: 80 },
  },
};
await writeFile(path.join(artifactDir, "plan.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath: path.join(artifactDir, "plan.json"), command: plan.command }));
