import test from "node:test";
import assert from "node:assert/strict";

import {
  LiveAeRecipeExecutionError,
  executeLiveAeRecipeV1,
} from "../.tmp/runtime/apps/desktop-host/src/live-recipe-runtime.js";

const plan = {
  schema: "editflow.recipe-compiler.live-ae.v1",
  recipeId: "recipe.test.live",
  compStableId: "comp.live",
  skippedOptionalNodeIds: [],
  actions: [{
    type: "PRECOMPOSE",
    nodeId: "precompose",
    compStableId: "comp.live",
    sourceLayerStableIds: ["layer.source"],
    childCompStableId: "comp.child",
    replacementLayerStableId: "layer.replacement",
    name: "Live Child",
  }, {
    type: "TIME_REMAP_ENABLE",
    nodeId: "enable-remap",
    compStableId: "comp.live",
    layerStableId: "layer.replacement",
  }, {
    type: "TIME_REMAP_PULSE",
    nodeId: "retime",
    compStableId: "comp.live",
    layerStableId: "layer.replacement",    keyTimesSeconds: [1, 1.5, 2],
    velocityContrast: 0.4,
    temporalPeakPhase: 0.5,
  }, {
    type: "CAMERA_PUSH",
    nodeId: "push",
    compStableId: "comp.live",
    layerStableId: "layer.replacement",
    keyTimesSeconds: [1, 1.5, 2],
    zoomIntensity: 0.3,
    zoomCenter: [0.6, 0.4],
    compWidth: 1080,
    compHeight: 1920,
  }],
};

class FakeBroker {
  constructor({ failFirstEase = false } = {}) {
    this.revision = 100;
    this.requests = [];
    this.failFirstEase = failFirstEase;
    this.failedEase = false;
    this.remapKeys = [
      { index: 1, time: 0, value: 0 },
      { index: 2, time: 3, value: 3 },
    ];
  }

  response(request, outcome, readback = null, error = null) {
    return {
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome,      error,
      affectedObjects: [],
      readback,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: this.revision,
      diagnostics: {
        adapterProtocolVersion: request.protocolVersion,
        adapterBuild: "fake",
        command: request.command,
        notes: [],
      },
      proofArtifactRefs: [],
    };
  }

  mutate(request, readback = null) {
    assert.equal(request.expectedHostProjectRevision, this.revision);
    this.revision += 1;
    return this.response(request, "APPLIED", readback);
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));

    if (request.command === "transaction.undo_last") {
      assert.equal(request.expectedHostProjectRevision, this.revision);
      this.revision += 1;
      return this.response(request, "APPLIED", { undone: true });
    }

    if (request.command === "layers.precompose") {
      return this.mutate(request, {
        replacementLayer: {
          stableId: "layer.replacement",
          transform: {
            anchorPoint: [540, 960, 0],
            position: [540, 960, 0],
            scale: [100, 100, 100],
          },
        },
      });
    }
    if (request.command === "layer.time_remap.enable") {
      return this.mutate(request, {
        timeRemapEnabled: true,
        propertyAvailable: true,
        canSetTimeRemapEnabled: true,
        propertyMatchName: "ADBE Time Remapping",
        numKeys: this.remapKeys.length,
        keys: this.remapKeys,
        layer: {
          stableId: "layer.replacement",
          hostId: 7,
          name: "Live Child",
          index: 1,
        },
      });
    }

    if (request.command === "layer.time_remap.readback") {
      return this.response(request, "NO_OP", {
        timeRemapEnabled: true,
        propertyAvailable: true,
        canSetTimeRemapEnabled: true,
        propertyMatchName: "ADBE Time Remapping",
        numKeys: this.remapKeys.length,
        keys: this.remapKeys,
        layer: {
          stableId: "layer.replacement",
          hostId: 7,
          name: "Live Child",
          index: 1,
        },
      });
    }

    if (request.command === "property.set_keyframes") {
      const propertyPath = request.payload.propertyPath;
      if (propertyPath?.[0] === "ADBE Time Remapping") {
        const authored = request.payload.keyframes.map((key) => ({
          time: key.time,          value: key.value,
        }));
        const byTime = new Map(this.remapKeys.map((key) => [key.time, {
          time: key.time,
          value: key.value,
        }]));
        for (const key of authored) byTime.set(key.time, key);
        this.remapKeys = [...byTime.values()]
          .sort((left, right) => left.time - right.time)
          .map((key, index) => ({ index: index + 1, ...key }));
      }
      return this.mutate(request, { numKeys: request.payload.keyframes.length });
    }

    if (request.command === "property.temporal_interpolation.set") {
      return this.mutate(request, { keyIndex: request.payload.keyIndex });
    }

    if (request.command === "property.temporal_ease.set") {
      if (this.failFirstEase && !this.failedEase) {
        this.failedEase = true;
        return this.response(request, "FAILED", null, {
          category: "PROOF_INJECTION",
          code: "INJECTED_EASE_FAILURE",
          message: "Injected temporal-ease failure.",
        });
      }
      return this.mutate(request, { keyIndex: request.payload.keyIndex });
    }

    throw new Error("Unexpected fake broker command: " + request.command);
  }
}

test("live recipe runtime spans the retained 1.1/1.7/1.8/2.7 protocols without UI fallbacks", async () => {
  const broker = new FakeBroker();
  let requestCounter = 0;
  const result = await executeLiveAeRecipeV1(plan, broker, {
    initialHostRevision: broker.revision,
    transactionId: "tutorial-live-success",
    requestIdFactory: () => "request-" + (++requestCounter),  });

  assert.equal(result.status, "PASS");
  assert.equal(result.appliedMutationCount, 11);
  assert.equal(result.finalHostRevision, broker.revision);
  const protocols = new Set(broker.requests.map((request) => request.protocolVersion));
  assert.deepEqual([...protocols].sort(), ["1.1.0", "1.7.0", "1.8.0", "2.7.0"]);
  assert.equal(
    broker.requests.filter((request) => request.command === "transaction.undo_last").length,
    0,
  );

  const retimeWrite = broker.requests.find((request) =>
    request.command === "property.set_keyframes"
    && request.payload.propertyPath?.[0] === "ADBE Time Remapping");
  assert.ok(retimeWrite);
  assert.ok(retimeWrite.payload.keyframes[1].value > 1.5);

  const transformWrites = broker.requests.filter((request) =>
    request.command === "property.set_keyframes"
    && request.payload.propertyPath?.[0] === "ADBE Transform Group");
  assert.equal(transformWrites.length, 2);
});

test("live recipe runtime undoes exactly the successful mutations before an injected failure", async () => {
  const broker = new FakeBroker({ failFirstEase: true });
  let requestCounter = 0;

  await assert.rejects(
    () => executeLiveAeRecipeV1(plan, broker, {
      initialHostRevision: broker.revision,
      transactionId: "tutorial-live-rollback",
      requestIdFactory: () => "request-" + (++requestCounter),
    }),
    (error) => {
      assert.ok(error instanceof LiveAeRecipeExecutionError);
      assert.equal(error.rollbackComplete, true);
      assert.match(String(error.causeError), /INJECTED_EASE_FAILURE/);
      return true;
    },
  );
  const failureIndex = broker.requests.findIndex((request) =>
    request.command === "property.temporal_ease.set");
  const successfulMutationsBeforeFailure = broker.requests
    .slice(0, failureIndex)
    .filter((request) =>
      request.command !== "layer.time_remap.readback");
  const undoRequests = broker.requests.filter((request) =>
    request.command === "transaction.undo_last");
  assert.equal(undoRequests.length, successfulMutationsBeforeFailure.length);
  assert.ok(undoRequests.length > 0);
});
