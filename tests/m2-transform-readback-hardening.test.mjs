import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_transform_readback.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("transform readback hardening copies AE array-like vectors into plain protocol arrays", async () => {
  const source = await readFile(hostPath, "utf8");

  assert.match(source, /request\.command === "layer\.set_transform"/);
  assert.match(source, /response\.readback\.transform = transformSnapshot\(layer\)/);
  assert.match(source, /var dimensions = layer\.threeDLayer \? 3 : 2/);
  assert.match(source, /length = value\.length/);
  assert.match(source, /typeof length !== "number" \|\| length < dimensions/);
  assert.match(source, /for \(i = 0; i < dimensions; i \+= 1\)/);
  assert.match(source, /typeof value\[i\] !== "number"/);
  assert.match(source, /out\.push\(value\[i\]\)/);
  assert.match(source, /ADBE Anchor Point/);
  assert.match(source, /ADBE Position/);
  assert.match(source, /ADBE Scale/);
  assert.match(source, /ADBE Rotate Z/);
  assert.match(source, /ADBE Opacity/);
  assert.doesNotMatch(source, /value instanceof Array/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("current AE loader installs transform readback hardening after protocol 1.1 hardening", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_transform_readback\.jsx/);

  const hardeningLoad = source.indexOf("$.evalFile(hardening)");
  const transformLoad = source.indexOf("$.evalFile(transformReadback)");
  const keyframeLoad = source.indexOf("$.evalFile(keyframeCrud)");
  assert.ok(hardeningLoad >= 0 && transformLoad > hardeningLoad && keyframeLoad > transformLoad);
});

test("CEP installer deploys transform readback hardening with the fixed host bundle", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /"editflow_host_transform_readback\.jsx"/);
  assert.match(source, /foreach \(\$FileName in \$HostFiles\)/);
  assert.match(source, /Required AE host file is missing/);
});
