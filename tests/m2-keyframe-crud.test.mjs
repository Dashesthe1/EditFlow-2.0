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
  const mutation = source.indexOf("property.removeKey(validated[i])");
  assert.ok(validation >= 0 && mutation > validation, "all key indices must be validated before any removeKey mutation");
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
