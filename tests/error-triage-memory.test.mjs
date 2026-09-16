import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_ERROR_RULE_COUNT,
  ErrorMemoryStore,
  diagnoseError,
  errorSignature,
} from "../.tmp/runtime/packages/error-triage/src/index.js";

test("fast triage recognizes recurring local failures without online research", () => {
  assert.ok(BUILTIN_ERROR_RULE_COUNT >= 10);
  const cases = [
    ["rg : The term 'rg' is not recognized as the name of a cmdlet", "MISSING_RIPGREP"],
    ["The token '&&' is not a valid statement separator in this version.", "POWERSHELL_AND_AND_UNSUPPORTED"],
    ["npm.ps1 cannot be loaded because running scripts is disabled on this system. FullyQualifiedErrorId : UnauthorizedAccess PSSecurityException", "POWERSHELL_NPM_PS1_BLOCKED"],
    ["ModuleNotFoundError: No module named 'mcp'", "PYTHON_WRONG_ENV_MCP"],
    ["=Join-Path : The term '=Join-Path' is not recognized", "POWERSHELL_VARIABLE_STRIPPED"],
    ["expected exactly one match for token, found 3", "PATCH_GUARD_NON_UNIQUE"],
    ["Windows cannot find '\"EditFlow Shadow Gateway\"'", "BAD_QUOTED_GATEWAY_COMMAND"],
    ["CEP_PANEL_REGISTRATION_TIMEOUT", "CEP_PANEL_REGISTRATION_TIMEOUT"],
    ["CEP_COMMAND_TIMEOUT: host.probe shadow-current-5", "CEP_HOST_PROBE_CALLBACK_STALL"],
    ["Broker leased an unsupported EditFlow protocol request", "CEP_PROTOCOL_MISMATCH"],
  ];
  for (const [message, code] of cases) {
    const result = diagnoseError(message);
    assert.equal(result.code, code);
    assert.equal(result.action, "APPLY_KNOWN_FIX");
    assert.equal(result.onlineLookup, null);
  }
});

test("unknown AE errors produce a bounded authoritative lookup plan", () => {
  const result = diagnoseError("After Effects error: native tracker failed with opaque code 73");
  assert.equal(result.domain, "AE");
  assert.equal(result.action, "ONLINE_LOOKUP");
  assert.equal(result.onlineLookup?.budgetMs, 10_000);
  assert.ok(result.onlineLookup?.preferredSources.includes("helpx.adobe.com"));
});

test("volatile paths and numbers do not create a new signature", () => {
  const a = errorSignature("Failure C:\\Users\\Shadow\\one\\file.ts line 123 pid 456");
  const b = errorSignature("Failure D:\\temp\\two\\file.ts line 999 pid 777");
  assert.equal(a, b);
});

test("verified resolutions persist and win over built-in or online lookup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-error-memory-"));
  try {
    const filePath = path.join(root, "memory.json");
    const first = new ErrorMemoryStore(filePath);
    const message = "Custom EditFlow failure code ABC-42 on fixture 9001";
    const entry = await first.remember({
      errorText: message,
      resolution: "Use the retained fixture reset path, then retry once.",
      avoidRepeat: "Do not rebuild the fixture.",
      domain: "EDITFLOW",
      code: "CUSTOM_FIXTURE_ABC",
      verified: true,
    });
    assert.equal(entry.successfulUses, 1);

    const reloaded = new ErrorMemoryStore(filePath);
    const diagnosis = await reloaded.diagnose(message);
    assert.equal(diagnosis.source, "MEMORY");
    assert.equal(diagnosis.code, "CUSTOM_FIXTURE_ABC");
    assert.equal(diagnosis.resolution, "Use the retained fixture reset path, then retry once.");
    assert.equal(diagnosis.action, "APPLY_KNOWN_FIX");
    assert.equal(diagnosis.occurrenceCount, 1);

    const failed = await reloaded.recordOutcome(diagnosis.signature, false);
    assert.equal(failed?.failedUses, 1);
    const stats = await reloaded.stats();
    assert.equal(stats.entries, 1);
    assert.equal(stats.successfulUses, 1);
    assert.equal(stats.failedUses, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
