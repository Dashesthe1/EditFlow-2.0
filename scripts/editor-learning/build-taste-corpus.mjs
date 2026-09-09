import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { EditorialTasteLibrary } from "../../.tmp/runtime/packages/editor-learning/src/reference-learning.js";
import { assertValidReferenceAnalysis } from "../../.tmp/runtime/packages/editor-learning/src/validation.js";

const inputDir = path.resolve(process.argv[2] ?? "training/reference-extractions");
const outputPath = path.resolve(process.argv[3] ?? "training/generated/editor-taste.json");

const entries = await readdir(inputDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  throw new Error(`No professional reference extraction JSON files found in ${inputDir}`);
}

const taste = new EditorialTasteLibrary();
for (const file of files) {
  const analysis = JSON.parse(await readFile(path.join(inputDir, file), "utf8"));
  assertValidReferenceAnalysis(analysis);
  taste.ingestReference(analysis);
}

const snapshot = taste.snapshot();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  inputDir,
  outputPath,
  referenceCount: snapshot.sources.length,
  principleCount: snapshot.principles.length,
  feedbackCount: snapshot.feedback.length,
}, null, 2));
