import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-null-rig-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-null-rig-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-null-rig-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-null-rig-real-ae-p1-p2.yml";
const triggerPath = ".github/ae-test-trigger/m3-null-rig-p1-p2.txt";

test("null-rig P1/P2 harness requires authenticated 1.5 with accepted 1.4 geometry witness and 1.1 setup", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /supportedProtocolVersions: \[AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /panel\.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /panel\.extensionVersion !== config\.extensionVersion/);
  assert.match(source, /environment\.hostName === "Adobe After Effects"/);
  assert.match(source, /blank_unsaved_baseline/);
});

test("null-rig P1 rejects dangerous or ambiguous requests without revision or fingerprint drift", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const code of [
    "HOST_REVISION_CONFLICT",
    "NULL_STABLE_ID_COLLISION",
    "NULL_CONTROLLER_REQUIRED",
    "NULL_RIG_DUPLICATE_CHILD",
    "NULL_RIG_SELF_REFERENCE",
    "NULL_RIG_CHILD_NOT_BOUND",
    "EXPECTED_HOST_REVISION_REQUIRED",
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /verifyRejectedWithoutMutation/);
  assert.match(source, /_revision_unchanged/);
  assert.match(source, /_fingerprint_unchanged/);
  assert.match(source, /checks\.p1 = p1Prefixes\.every/);
});

test("null-rig P2 proves true null creation, multi-child bind/unbind, idempotency, order, and independent five-point geometry", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /"layer\.null_create"/);
  assert.match(source, /"layer\.null_readback"/);
  assert.match(source, /"rig\.bind_children_to_null_preserve_transform"/);
  assert.match(source, /"rig\.unbind_children_from_null_preserve_transform"/);
  assert.match(source, /"rig\.relationship_readback"/);
  assert.match(source, /p2_repeat_null_create_no_op/);
  assert.match(source, /p2_repeat_bind_no_op/);
  assert.match(source, /childStables = \[childAStable, childBStable, childCStable\]/);
  assert.match(source, /p2_project_snapshot_all_bound/);
  assert.match(source, /p2_project_snapshot_all_unbound/);
  assert.match(source, /p2_layer_order_preserved_after_bind/);
  assert.match(source, /p2_layer_order_preserved_after_unbind/);
  for (const point of ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"]) {
    assert.match(source, new RegExp(point));
  }
  assert.match(source, /M3_NULL_RIG_P1_P2_GEOMETRY_WITNESS/);
  assert.match(source, /geometryClose\(initialGeometry\[stableId\]/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("null-rig P1/P2 cleanup is stable-ID scoped and must restore the exact blank fingerprint", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /cleanup_target_fixture_owned/);
  assert.match(source, /Target composition contains layers outside the exact null-rig proof fixture; refusing broad cleanup/);
  assert.match(source, /sameStableIdSet\(stableIds, expectedIds\)/);
  assert.match(source, /cleanupComp\(targetStable\)/);
  assert.match(source, /cleanupComp\(sourceStable\)/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /cleanup_file_path_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanupComplete = cleanupErrors\.length === 0/);
});

test("null-rig acceptance wrapper fails closed on proof overclaim, geometry drift, layer reorder, or cleanup drift", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /m3-null-rig-p1-p2-cli\.js/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /p2_null_create_applied/);
  assert.match(source, /p2_bind_geometry_preserved/);
  assert.match(source, /p2_unbind_geometry_preserved/);
  assert.match(source, /p2_layer_order_preserved_after_bind/);
  assert.match(source, /cleanup_target_fixture_owned/);
  assert.match(source, /cleanup_fingerprint_restored/);
});

test("null-rig self-hosted runner uses accepted launcher hardening and repository preflight before AE", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /npm run check/);
  assert.match(source, /run-m3-null-rig-p1-p2\.ps1/);
  assert.match(source, /proofs\\artifacts\\m3-null-rig-p1-p2/);
  assert.match(source, /authenticated protocol 1\.5 registration/);
  assert.match(source, /EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(source, /EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.doesNotMatch(source, /EDITFLOW_M3_NULL_RIG_P4_PROOF=1/);
});

test("null-rig P1/P2 workflow is isolated on a trigger-only self-hosted control branch", async () => {
  const [workflow, trigger] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(triggerPath, "utf8"),
  ]);
  assert.match(workflow, /ae-test\/m3-null-rig-p1-p2-control/);
  assert.match(workflow, /\.github\/ae-test-trigger\/m3-null-rig-p1-p2\.txt/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(workflow, /run-m3-null-rig-self-hosted\.ps1/);
  assert.match(workflow, /m3-null-rig-p1-p2-proof-/);
  assert.match(workflow, /proofs\/artifacts\/m3-null-rig-p1-p2/);
  assert.match(trigger, /P3\/P4\/P5 remain unclaimed/);
});
