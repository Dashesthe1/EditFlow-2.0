import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_null_rigs.jsx";

test("managed null lifecycle owns and reclaims only its exact AE backing source", async () => {
  const source = await readFile(hostPath, "utf8");

  assert.match(source, /NULL_SOURCE_PREFIX = "\[\[EDITFLOW2_NULL_SOURCE:"/);
  assert.match(source, /SUPPORT_FOLDER_MARKER = "\[\[EDITFLOW2_NULL_SUPPORT_FOLDER\]\]"/);
  assert.match(source, /var itemIdsBeforeCreate = projectItemIdSet\(\);/);
  assert.match(source, /createdSource\.comment = nullSourceMarker\(prepared\.createSpec\.stableId\)/);
  assert.match(source, /!itemWasPresent\(itemIdsBeforeCreate, createdFolder\)/);
  assert.match(source, /createdFolder\.comment = SUPPORT_FOLDER_MARKER/);

  assert.match(source, /NULL_RIG_SOURCE_OWNERSHIP_MISMATCH/);
  assert.match(source, /NULL_RIG_SOURCE_IN_USE/);
  assert.match(source, /sourceUsedByOtherLayer\(ownedSource, prepared\.rig\)/);
  assert.match(source, /prepared\.rig\.remove\(\);\s*ownedSource\.remove\(\);/s);
  assert.match(source, /ownedSupportFolder\.numItems === 0/);
  assert.match(source, /folderIsManagedSupport\(ownedSupportFolder\)/);
  assert.match(source, /NULL_RIG_SOURCE_REMOVE_READBACK_MISMATCH/);

  assert.doesNotMatch(source, /removeUnusedFootage/i);
  assert.doesNotMatch(source, /executeCommand\([^)]*remove unused/i);
});
