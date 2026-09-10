import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const extraction = {
  source: {
    sourceId: "tutorial.compiler.01",
    title: "Compiler fixture",
    sourceRef: "fixture.mp4",
    durationSeconds: 30,
    tags: ["impact"],
  },
  demonstrations: [{
    demonstrationId: "demo.compiler.01",
    sourceId: "tutorial.compiler.01",
    title: "Fixture demonstration",
    objective: "Create a readable impact",
    contextTags: ["impact"],
    actions: [],
    observations: [],
    inferredPrinciples: [],
    candidateSkillIds: ["skill.compiler.impact"],
  }],
  skills: [{
    id: "skill.compiler.impact",
    name: "Compiler Impact",
    summary: "Fixture skill used to prove corpus compilation.",
    domains: ["timing"],
    tags: ["impact"],
    intents: ["accent"],
    prerequisites: [],
    whenToUse: ["A clear accent exists."],
    whenNotToUse: [],
    whyItWorks: ["Contrast creates emphasis."],
    procedure: [],
    parameterGuidance: [],
    visualTargets: ["Impact remains readable."],
    failureModes: [],
    adaptationRules: [],
    variants: [],
    sourceIds: ["tutorial.compiler.01"],
    confidence: 0.7,
    mastery: "OBSERVED",
  }],
  edges: [],
};

const runCompiler = (inputDir, outputPath) => spawnSync(
  process.execPath,
  ["scripts/editor-learning/build-corpus.mjs", inputDir, outputPath],
  { cwd: process.cwd(), encoding: "utf8" },
);

test("tutorial corpus compiler builds a deterministic knowledge snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-learning-"));
  const inputDir = path.join(root, "inputs");
  const outputPath = path.join(root, "generated", "knowledge.json");
  await mkdir(inputDir, { recursive: true });
  await writeFile(path.join(inputDir, "tutorial-01.json"), `${JSON.stringify(extraction, null, 2)}\n`, "utf8");

  try {
    const result = runCompiler(inputDir, outputPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(snapshot.schemaVersion, "1.0.0");
    assert.equal(snapshot.tutorialSources.length, 1);
    assert.equal(snapshot.demonstrations.length, 1);
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0].id, "skill.compiler.impact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("committed tutorial extractions compile as real corpus data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-real-corpus-"));
  const outputPath = path.join(root, "knowledge.json");

  try {
    const result = runCompiler("training/tutorial-extractions", outputPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
    const source = snapshot.tutorialSources.find((item) => item.sourceId === "tutorial.microwave_trend_after_effects");
    assert.ok(source, "expected real microwave tutorial source in compiled corpus");
    assert.ok(snapshot.demonstrations.length >= 4);
    assert.ok(snapshot.skills.length >= 5);
    assert.ok(snapshot.skills.some((item) => item.id === "skill.flow_shaped_time_remap"));
    assert.ok(snapshot.skills.some((item) => item.id === "skill.staggered_duplicate_cascade"));
    assert.ok(snapshot.skills.some((item) => item.id === "skill.glitch_monochrome_chromatic_accent"));
    assert.ok(snapshot.skills.some((item) => item.id === "skill.short_white_flash_accent"));
    assert.ok(snapshot.skills.every((item) => item.mastery === "OBSERVED"), "tutorial observation alone must not promote mastery");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
