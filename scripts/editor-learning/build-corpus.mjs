import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { EditorKnowledgeBase } from "../../.tmp/runtime/packages/editor-learning/src/index.js";

const inputDir = path.resolve(process.argv[2] ?? "training/tutorial-extractions");
const outputPath = path.resolve(process.argv[3] ?? "training/generated/editor-knowledge.json");

const entries = await readdir(inputDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  throw new Error(`No tutorial extraction JSON files found in ${inputDir}`);
}

const knowledge = new EditorKnowledgeBase();
for (const file of files) {
  const extraction = JSON.parse(await readFile(path.join(inputDir, file), "utf8"));
  knowledge.ingestTutorial(extraction);
}

const snapshot = knowledge.snapshot();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  inputDir,
  outputPath,
  tutorialCount: snapshot.tutorialSources.length,
  demonstrationCount: snapshot.demonstrations.length,
  skillCount: snapshot.skills.length,
  edgeCount: snapshot.edges.length,
  experienceCount: snapshot.experiences.length,
}, null, 2));
