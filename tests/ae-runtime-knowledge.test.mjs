import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const sampleKnowledge = () => ({
  schemaVersion: "1.0.0",
  profilerVersion: "1.0.0",
  capturedAt: "2026-09-09T01:00:00.000Z",
  source: "RUNTIME_EXTENDSCRIPT",
  host: {
    name: "Adobe After Effects",
    version: "26.3.0",
    buildName: "test-build",
    buildNumber: "1",
    locale: "en_US",
    isRenderEngine: false,
    os: "Windows",
  },
  project: {
    open: true,
    name: "fixture.aep",
    filePath: "C:/fixture.aep",
    itemCount: 1,
    revision: 4,
  },
  applicationReflection: {
    name: "Application",
    description: "localized description",
    help: null,
    properties: [{
      name: "effects",
      kind: "PROPERTY",
      dataType: "Array",
      description: null,
      help: null,
      defaultValue: null,
      min: null,
      max: null,
      isCollection: true,
      arguments: [],
    }],
    methods: [],
  },
  projectReflection: null,
  installedEffects: [
    { displayName: "Glow", category: "Stylize", matchName: "ADBE Glo2", version: "1.0" },
    { displayName: "Gaussian Blur", category: "Blur & Sharpen", matchName: "ADBE Gaussian Blur 2", version: "2.0" },
  ],
  activeComposition: {
    hostId: 7,
    name: "Fixture",
    width: 1920,
    height: 1080,
    duration: 2,
    frameRate: 24,
    layerCount: 1,
    layers: [{
      index: 1,
      name: "Layer 1",
      className: "AVLayer",
      reflection: null,
      properties: [{
        name: "Transform",
        matchName: "ADBE Transform Group",
        propertyIndex: 2,
        propertyDepth: 1,
        propertyType: "NAMED_GROUP",
        propertyValueType: null,
        isEffect: false,
        isMask: false,
        canSetEnabled: false,
        enabled: true,
        canSetExpression: null,
        canVaryOverTime: null,
        isSpatial: null,
        hasMin: null,
        minValue: null,
        hasMax: null,
        maxValue: null,
        unitsText: null,
        children: [{
          name: "Position",
          matchName: "ADBE Position",
          propertyIndex: 2,
          propertyDepth: 2,
          propertyType: "PROPERTY",
          propertyValueType: "TWO_D_SPATIAL",
          isEffect: false,
          isMask: false,
          canSetEnabled: false,
          enabled: true,
          canSetExpression: true,
          canVaryOverTime: true,
          isSpatial: true,
          hasMin: false,
          minValue: null,
          hasMax: false,
          maxValue: null,
          unitsText: "pixels",
          children: [],
        }],
      }],
    }],
  },
  warnings: [],
});

test("AE runtime profiler is read-only and captures the high-value introspection surfaces", async () => {
  const host = await read("packages/adapters/ae-cep/host/editflow_host_runtime_knowledge.jsx");
  assert.ok(host.includes("app.effects"));
  assert.ok(host.includes("target.reflect"));
  assert.ok(host.includes('readString(property, "matchName")'));
  assert.ok(host.includes('readBoolean(property, "canSetExpression")'));
  assert.ok(host.includes('readBoolean(property, "canVaryOverTime")'));
  assert.ok(host.includes("propertyValueTypeName(property.propertyValueType)"));
  assert.ok(host.includes("MAX_PROPERTY_DEPTH"));
  assert.ok(host.includes("MAX_PROPERTIES_PER_GROUP"));
  assert.equal(host.includes("setValue("), false);
  assert.equal(host.includes("setValueAtTime("), false);
  assert.equal(host.includes("beginUndoGroup"), false);
  assert.equal(host.includes("addProperty("), false);
  assert.equal(host.includes(".remove()"), false);
});

test("runtime knowledge capture reuses warm AE and never escalates to restart/termination", async () => {
  const runner = await read("scripts/windows/capture-ae-runtime-knowledge.ps1");
  assert.ok(runner.includes('return [pscustomobject]@{ Process = $Matches[0]'));
  assert.ok(runner.includes('@("-r",'));
  assert.ok(runner.includes("pidBefore = $TargetPid"));
  assert.ok(runner.includes("restarted = $false"));
  assert.ok(runner.includes("Allow Scripts to Write Files and Access Network"));
  assert.equal(runner.includes("Stop-Process"), false);
  assert.equal(runner.includes("CloseMainWindow"), false);
  assert.equal(runner.includes("taskkill"), false);
});

test("runtime knowledge index canonicalizes effects and resolves exact property matchName paths", async () => {
  const knowledgeModule = await import(new URL("../.tmp/runtime/packages/ae-object-model/src/knowledge.js", import.meta.url));
  const snapshot = sampleKnowledge();
  const normalized = knowledgeModule.normalizeAeRuntimeKnowledgeSnapshot(snapshot);
  assert.deepEqual(normalized.installedEffects.map((effect) => effect.matchName), ["ADBE Gaussian Blur 2", "ADBE Glo2"]);

  const index = new knowledgeModule.AeRuntimeKnowledgeIndex(snapshot);
  assert.equal(index.getInstalledEffect("ADBE Glo2")?.displayName, "Glow");
  assert.equal(index.searchInstalledEffects("blur").length, 1);
  const position = index.findProperties("ADBE Position");
  assert.equal(position.length, 1);
  assert.deepEqual(position[0].path, ["ADBE Transform Group", "ADBE Position"]);
  assert.equal(position[0].property.canSetExpression, true);
});

test("runtime knowledge fingerprint ignores capture/project/localized noise", async () => {
  const knowledgeModule = await import(new URL("../.tmp/runtime/packages/ae-object-model/src/knowledge.js", import.meta.url));
  const first = sampleKnowledge();
  const second = sampleKnowledge();
  second.capturedAt = "2030-01-01T00:00:00.000Z";
  second.project.name = "different.aep";
  second.project.filePath = "D:/other.aep";
  second.project.revision = 999;
  second.installedEffects[0].displayName = "Localized Glow Name";
  second.installedEffects[0].category = "Localized Category";
  second.warnings = ["project-specific warning"];
  second.activeComposition.name = "Different Comp";
  assert.deepEqual(
    knowledgeModule.toAeRuntimeKnowledgeFingerprintInput(first),
    knowledgeModule.toAeRuntimeKnowledgeFingerprintInput(second),
  );
});

test("successful runtime capture upgrades inspection capabilities without overclaiming property write parity", async () => {
  const core = await import(new URL("../.tmp/runtime/packages/core-contracts/src/index.js", import.meta.url));
  const registryModule = await import(new URL("../.tmp/runtime/packages/capability-registry/src/index.js", import.meta.url));
  const knowledgeAdapter = await import(new URL("../.tmp/runtime/packages/capability-registry/src/ae-runtime-knowledge.js", import.meta.url));
  const fingerprint = core.asEnvironmentFingerprint("environment:sha256:fixture");
  const registry = registryModule.createM1CapabilityRegistry(fingerprint, "2026-09-09T01:00:00.000Z");
  registry.registerAdapter(knowledgeAdapter.createAeRuntimeKnowledgeDeclaration(sampleKnowledge(), fingerprint));

  const effectCatalog = registry.resolve(core.asCapabilityId("ae.effect.catalog.inspect"));
  assert.equal(effectCatalog.capability.status, "FULL");
  assert.equal(effectCatalog.capability.proofMaturity, "STRUCTURAL");
  assert.equal(effectCatalog.route.kind, "HOST_ADAPTER");

  const propertyGraph = registry.get(core.asCapabilityId("ae.property.graph.inspect"));
  assert.equal(propertyGraph?.status, "PARTIAL");
  assert.ok(propertyGraph?.limitations?.some((value) => value.includes("not considered safely writable")));

  const writeCapability = registry.get(core.asCapabilityId("ae.effect.property.set"));
  assert.equal(writeCapability?.status, "ADAPTER_REQUIRED");
});
