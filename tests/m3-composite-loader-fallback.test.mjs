import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";

test("protocol 1.3 composite load failure cannot take accepted 1.1/1.2 dispatch offline", async () => {
  const source = await readFile(loaderPath, "utf8");

  assert.match(source, /var compositeLoadError = null/);
  assert.match(source, /try \{\s*\$\.evalFile\(m3Composite\);\s*\} catch \(compositeError\)/s);
  assert.match(source, /var dispatchBeforeCompositeFailure = \$\.global\.EditFlow2_dispatch/);
  assert.match(source, /request && request\.protocolVersion === "1\.3\.0"/);
  assert.match(source, /code: "M3_COMPOSITE_MODULE_LOAD_FAILED"/);
  assert.match(source, /return dispatchBeforeCompositeFailure\(requestJson\)/);
  assert.match(source, /EditFlow2_M3_COMPOSITE_LOAD_ERROR/);
});
