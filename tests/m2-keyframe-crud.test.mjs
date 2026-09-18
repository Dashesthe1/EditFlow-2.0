import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const crudPath = "packages/adapters/ae-cep/host/editflow_host_keyframe_crud.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("typed keyframe removal stays inside property.set_keyframes and validates before mutation", async () => {
  const source = await readFile(crudPath, "utf8");
  assert.match(source, /request\.command !== "property\.set_keyframes"/);
  assert.match(source, /removeKeyIndices/);
  assert.match(source, /KEYFRAME_MODE_CONFLICT/);
  assert.match(source, /REMOVE_KEY_INDICES_REQUIRED/);
  assert.match(source, /INVALID_KEY_INDEX/);
  assert.match(source, /KEY_INDEX_OUT_OF_RANGE/);
  assert.match(source, /DUPLICATE_KEY_INDEX/);
  const validation = source.indexOf("validated.sort");
  const undoBegin = source.indexOf('app.beginUndoGroup("EditFlow 2.0: property.set_keyframes remove")');
  const mutation = source.indexOf("property.removeKey(validated[i])");
  const undoEnd = source.indexOf("app.endUndoGroup();", undoBegin);
  assert.ok(validation >= 0 && undoBegin > validation, "undo grouping must begin only after all key indices validate");
  assert.ok(mutation > undoBegin, "removeKey mutation must execute inside the request-owned undo group");
  assert.ok(undoEnd > mutation, "successful keyframe removal must close the request-owned undo group");
});

test("typed keyframe removal closes its undo group on failure so outer atomicity can self-rollback", async () => {
  const source = await readFile(crudPath, "utf8");
  const catchIndex = source.indexOf("} catch (error) {");
  const closeIndex = source.indexOf("if (undoOpen)", catchIndex);
  const failureIndex = source.indexOf('failResponse(request, "FAILED"', catchIndex);
  assert.ok(catchIndex >= 0 && closeIndex > catchIndex && failureIndex > closeIndex);
});

test("typed keyframe removal sorts descending so AE key indices cannot shift underneath the operation", async () => {
  const source = await readFile(crudPath, "utf8");
  assert.match(source, /validated\.sort\(function \(left, right\) \{ return right - left; \}\)/);
  assert.match(source, /mode: "REMOVE_KEY_INDICES"/);
  assert.match(source, /removedCount: validated\.length/);
  assert.match(source, /removedKeyIndices: validated/);
  assert.match(source, /removedKeyTimes: removedTimes/);
  assert.match(source, /numKeys: property\.numKeys/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("current host loads keyframe CRUD after protocol hardening and before atomicity", async () => {
  const source = await readFile(loaderPath, "utf8");
  const hardening = source.indexOf("$.evalFile(hardening)");
  const keyframes = source.indexOf("$.evalFile(keyframeCrud)");
  const atomicity = source.indexOf("$.evalFile(atomicity)");
  assert.ok(hardening >= 0 && keyframes > hardening && atomicity > keyframes);
  assert.match(source, /editflow_host_keyframe_crud\.jsx/);
});

test("CEP installer copies the keyframe CRUD host layer", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /"editflow_host_keyframe_crud\.jsx"/);
});
