import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MARKER_MOTION_PROTOCOL_VERSION_V20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMarkerMotionRequestV20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const required = (name) => { const v = arg(name); if (!v) throw new Error(`Missing required argument ${name}.`); return v; };
const stripBom = (s) => s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
const nested = (v, key) => { const r = record(v); return r ? record(r[key]) : null; };
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : record(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nonEmpty = async (p) => { try { return (await stat(p)).size > 0; } catch { return false; } };
const writeJson = async (p, v) => { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8"); };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const parseConfig = (value) => {
  const c = record(value);
  if (!c || c.schemaVersion !== 1 || c.host !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error("Bridge port is invalid.");
  if (typeof c.token !== "string" || c.token.length < 32) throw new Error("Bridge token is invalid.");
  if (c.protocolVersion !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocol mismatch.");
  if (!Array.isArray(c.supportedProtocolVersions) || !c.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !c.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) throw new Error("Bridge does not advertise protocol 2.0 and 1.1.");
  return c;
};
const markerState = (response) => Array.isArray(response?.readback?.markers) ? response.readback.markers : [];
const compState = (response) => nested(nested(response?.readback, "compMotion"), "state");
const layerState = (response) => nested(nested(response?.readback, "layerMotion"), "state");
const launchScript = async (exe, script) => new Promise((resolve, reject) => { const child = spawn(exe, ["-r", script], { stdio: "ignore", windowsHide: false }); child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); }); });
const waitMarker = async (p, proofId, timeoutMs) => { const deadline = Date.now() + timeoutMs; let last = null; while (Date.now() < deadline) { try { const v = JSON.parse(stripBom(await readFile(p, "utf8"))); if (v?.proofId === proofId && typeof v.ok === "boolean") return v; last = "invalid marker"; } catch (e) { last = e instanceof Error ? e.message : String(e); } await sleep(100); } throw new Error(`PROOF_MARKER_TIMEOUT: ${proofId}${last ? ` (${last})` : ""}`); };
const sessionEvidence = (s) => ({ sessionId: s.sessionId, protocolVersion: s.protocolVersion, supportedProtocolVersions: [...s.supportedProtocolVersions], extensionId: s.extensionId, extensionVersion: s.extensionVersion, registeredAt: s.registeredAt });

const main = async () => {
  const configPath = required("--config"), resultPath = required("--result"), afterFxPath = required("--afterfx-path"), reopenScript = required("--reopen-script"), cleanupScript = required("--cleanup-script");
  const timeoutMs = Number(arg("--timeout-ms") ?? "90000"); if (!Number.isFinite(timeoutMs) || timeoutMs < 20000) throw new Error("--timeout-ms must be at least 20000.");
  const artifactDir = path.dirname(resultPath), projectPath = path.join(artifactDir, "m3-marker-motion-p5-transfer.aep"), reopenMarkerPath = path.join(artifactDir, "reopen-result.json"), cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
  const startedAt = new Date().toISOString(), checks = {}, responses = [], cleanupErrors = [];
  let broker = null, client = null, state = null, hostRevision = null, initialSession = null, reconnectedSession = null, failureError = null, cleanupComplete = false, savedFingerprint = null;
  let beforeComp = null, beforeLayer = null, beforeCompMarkers = null, beforeLayerMarkers = null, requestCounter = 0, operationCounter = 0;
  const projectId = "m3-marker-motion-p5-real-ae", prefix = `M3_MARKER_MOTION_P5_${Date.now()}`, transactionId = `${prefix}_TX`, sourceStable = `${prefix}_SOURCE_COMP`, targetStable = `${prefix}_TARGET_COMP`, layerStable = `${prefix}_LAYER`;
  const compTarget = { kind: "COMP", comp: { stableId: targetStable } }, layerTarget = { kind: "LAYER", comp: { stableId: targetStable }, layer: { stableId: layerStable } };
  const compMarker = { comment: "P5 comp transfer", chapter: "Marker Motion", url: "", frameTarget: "transfer", cuePointName: "p5", duration: 0.125, eventCuePoint: true, label: 9, protectedRegion: true, parameters: { proof: "p5", surface: "comp" } };
  const layerMarker = { comment: "P5 layer transfer", chapter: "Marker Motion", url: "", frameTarget: "layer", cuePointName: "p5-layer", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { proof: "p5", surface: "layer" } };
  const compMotion = { motionBlur: true, frameBlending: true, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 64 };
  const layerMotion = { motionBlur: true, frameBlendingType: "FRAME_MIX" };

  const rec = (r) => responses.push({ protocolVersion: r.protocolVersion, command: r.command, outcome: r.outcome, error: r.error ?? null, hostProjectRevision: r.hostProjectRevision ?? null, notes: r.diagnostics?.notes ?? [] });
  const refresh = async () => { const o = await client.observe(projectId); state = o.observed; hostRevision = o.hostRevision; return o; };
  const execV11 = async (command, payload, profile = "M3_MARKER_MOTION_P5_TRANSFER") => { const r = await client.executePublic(command, { transactionId, operationId: `${transactionId}_V11_${++operationCounter}`, payload, expectedState: state, readbackProfile: profile }); rec(r); if (r.outcome === "FAILED" || r.outcome === "REJECTED") throw new Error(`${command}: ${r.error?.code ?? r.outcome}`); await refresh(); return r; };
  const dispatch = async (command, payload, expected = null, profile = "M3_MARKER_MOTION_P5_TRANSFER") => { const r = await broker.dispatch(buildMarkerMotionRequestV20({ requestId: `m3-marker-motion-p5-${++requestCounter}`, transactionId, operationId: `${transactionId}_V20_${++operationCounter}`, command, expectedHostProjectRevision: expected, payload, readbackProfile: profile })); rec(r); if (typeof r.hostProjectRevision === "number") hostRevision = r.hostProjectRevision; return r; };
  const makeClient = () => new AeCepAdapterClientV11(broker, () => `m3-marker-motion-p5-v11-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
  const readAll = async () => {
    const cm = await dispatch("comp.motion.readback", { comp: { stableId: targetStable } });
    const lm = await dispatch("layer.motion.readback", { comp: { stableId: targetStable }, layer: { stableId: layerStable } });
    const cmark = await dispatch("marker.readback", { target: compTarget });
    const lmark = await dispatch("marker.readback", { target: layerTarget });
    return { comp: compState(cm), layer: layerState(lm), compMarkers: markerState(cmark), layerMarkers: markerState(lmark) };
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([rm(resultPath,{force:true}),rm(projectPath,{force:true}),rm(reopenMarkerPath,{force:true}),rm(cleanupMarkerPath,{force:true})]);
    checks.proof_scripts_present = (await stat(reopenScript)).isFile() && (await stat(cleanupScript)).isFile(); checks.afterfx_present = (await stat(afterFxPath)).isFile();
    const config = parseConfig(JSON.parse(stripBom(await readFile(configPath,"utf8"))));
    broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: Math.min(timeoutMs, 15000), commandLeaseMs: 2000, expectedExtensionId: config.extensionId, supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11] });
    if (await broker.start() !== config.port) throw new Error("Broker bound unexpected port.");
    const firstPanel = await broker.waitForPanel(Math.min(timeoutMs,15000)); initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_v20 = firstPanel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20 && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11); if (!checks.initial_panel_v20) throw new Error("Initial protocol-2.0 panel negotiation failed.");
    client = makeClient(); const env = await client.probe(); checks.host_probe = env.hostName === "Adobe After Effects"; if(!checks.host_probe) throw new Error("Host probe failed.");
    const baseline = await refresh(); checks.blank_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null; if(!checks.blank_baseline) throw new Error("P5 requires a blank unsaved proof-safe baseline.");

    await execV11("comp.create", { stableId: sourceStable, name: `${prefix} Source`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    await execV11("comp.create", { stableId: targetStable, name: `${prefix} Target`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    await execV11("layer.add_media", { stableId: layerStable, comp: { stableId: targetStable }, item: { stableId: sourceStable } });
    let r = await dispatch("marker.set", { target: compTarget, time: 0.25, marker: compMarker }, hostRevision); if(!["APPLIED","NO_OP"].includes(r.outcome)) throw new Error(`comp marker set: ${r.error?.code ?? r.outcome}`); await refresh();
    r = await dispatch("marker.set", { target: layerTarget, time: 0.5, marker: layerMarker }, hostRevision); if(!["APPLIED","NO_OP"].includes(r.outcome)) throw new Error(`layer marker set: ${r.error?.code ?? r.outcome}`); await refresh();
    r = await dispatch("comp.motion.set", { comp: { stableId: targetStable }, state: compMotion }, hostRevision); if(!["APPLIED","NO_OP"].includes(r.outcome)) throw new Error(`comp motion set: ${r.error?.code ?? r.outcome}`); await refresh();
    r = await dispatch("layer.motion.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, state: layerMotion }, hostRevision); if(!["APPLIED","NO_OP"].includes(r.outcome)) throw new Error(`layer motion set: ${r.error?.code ?? r.outcome}`); await refresh();
    const pre = await readAll(); beforeComp=pre.comp; beforeLayer=pre.layer; beforeCompMarkers=pre.compMarkers; beforeLayerMarkers=pre.layerMarkers;
    checks.pre_save_exact = equal(beforeComp,compMotion) && beforeLayer?.motionBlur===true && beforeLayer?.frameBlendingType==="FRAME_MIX" && beforeCompMarkers.length===1 && beforeLayerMarkers.length===1; if(!checks.pre_save_exact) throw new Error("Pre-save marker/motion readback is not exact.");

    await execV11("project.save", { path: projectPath }, "M3_MARKER_MOTION_P5_SAVE"); checks.saved_project_artifact = await nonEmpty(projectPath); if(!checks.saved_project_artifact) throw new Error("project.save did not produce .aep.");
    const saved = await refresh(); savedFingerprint=saved.observed.projectFingerprint; checks.saved_project_path = saved.project.filePath && samePath(saved.project.filePath,projectPath); checks.saved_fixture = saved.project.itemCount===2; if(!checks.saved_project_path||!checks.saved_fixture) throw new Error("Saved structural readback failed.");

    await launchScript(afterFxPath,reopenScript); const reopen = await waitMarker(reopenMarkerPath,"M3_MARKER_MOTION_P5_REOPEN",timeoutMs); checks.reopen_passed = reopen.ok===true && reopen.dispatcherReady===true && reopen.itemCount===2 && samePath(reopen.projectPath,projectPath); if(!checks.reopen_passed) throw new Error(`Reopen failed: ${reopen.error ?? "invalid marker"}`);
    const firstSession = initialSession.sessionId; await broker.stop(); await sleep(300); if(await broker.start()!==config.port) throw new Error("Broker rebound unexpected port.");
    const secondPanel = await broker.waitForPanel(Math.min(timeoutMs,15000)); reconnectedSession=sessionEvidence(secondPanel); checks.authenticated_reconnect = secondPanel.sessionId!==firstSession && secondPanel.protocolVersion===AE_MARKER_MOTION_PROTOCOL_VERSION_V20 && secondPanel.extensionId===config.extensionId && secondPanel.extensionVersion===config.extensionVersion; if(!checks.authenticated_reconnect) throw new Error("Distinct authenticated CEP reconnect failed.");
    client=makeClient(); const env2=await client.probe(); checks.post_reconnect_host_probe=env2.hostName==="Adobe After Effects"; const reopened=await refresh(); checks.reopened_project_path=reopened.project.filePath&&samePath(reopened.project.filePath,projectPath); checks.reopened_stable_ids=reopened.project.itemCount===2&&reopened.project.items.some(i=>i.stableId===sourceStable)&&reopened.project.items.some(i=>i.stableId===targetStable&&i.composition?.layers.some(l=>l.stableId===layerStable)); checks.saved_fingerprint_preserved=reopened.observed.projectFingerprint===savedFingerprint;
    const post=await readAll(); checks.comp_motion_exact_after_reconnect=equal(post.comp,beforeComp); checks.layer_motion_exact_after_reconnect=post.layer?.motionBlur===beforeLayer?.motionBlur&&post.layer?.frameBlendingType===beforeLayer?.frameBlendingType; checks.comp_marker_exact_after_reconnect=equal(post.compMarkers,beforeCompMarkers); checks.layer_marker_exact_after_reconnect=equal(post.layerMarkers,beforeLayerMarkers); if(!checks.comp_motion_exact_after_reconnect||!checks.layer_motion_exact_after_reconnect||!checks.comp_marker_exact_after_reconnect||!checks.layer_marker_exact_after_reconnect) throw new Error("Marker/motion state changed across save/reopen/reconnect.");

    const mutatedComp={...compMotion,shutterAngle:270,shutterPhase:-135}; r=await dispatch("comp.motion.set",{comp:{stableId:targetStable},state:mutatedComp},hostRevision,"M3_MARKER_MOTION_P5_POST_RECONNECT"); if(r.outcome!=="APPLIED") throw new Error(`Post-reconnect comp mutation failed: ${r.error?.code ?? r.outcome}`); await refresh();
    const mutatedMarker={...layerMarker,comment:"P5 layer reconnect mutation",label:6}; r=await dispatch("marker.set",{target:layerTarget,time:0.5,marker:mutatedMarker},hostRevision,"M3_MARKER_MOTION_P5_POST_RECONNECT"); if(!["APPLIED","NO_OP"].includes(r.outcome)) throw new Error(`Post-reconnect marker mutation failed: ${r.error?.code ?? r.outcome}`); await refresh();
    const fresh=await readAll(); checks.post_reconnect_comp_mutation=equal(fresh.comp,mutatedComp); checks.post_reconnect_marker_mutation=fresh.layerMarkers.length===1&&fresh.layerMarkers[0]?.marker?.comment===mutatedMarker.comment&&fresh.layerMarkers[0]?.marker?.label===6; if(!checks.post_reconnect_comp_mutation||!checks.post_reconnect_marker_mutation) throw new Error("Fresh post-reconnect mutation/readback failed.");
  } catch (e) { failureError=e instanceof Error?(e.stack??e.message):String(e); }
  finally {
    if (broker) { try { await broker.stop(); } catch(e){cleanupErrors.push(String(e));} }
    if (await nonEmpty(projectPath)) {
      try { await launchScript(afterFxPath,cleanupScript); const cleanup=await waitMarker(cleanupMarkerPath,"M3_MARKER_MOTION_P5_CLEANUP",Math.min(timeoutMs,15000)); cleanupComplete=cleanup.ok===true&&cleanup.blankItemCount===0; if(!cleanupComplete)cleanupErrors.push(cleanup.error??"cleanup marker rejected"); } catch(e){cleanupErrors.push(e instanceof Error?e.message:String(e));}
    } else { cleanupErrors.push("Saved project was not available for proof-owned cleanup."); }
    checks.saved_project_retained_after_cleanup=await nonEmpty(projectPath);
    if(cleanupErrors.length)cleanupComplete=false;
    const p5 = failureError===null && cleanupComplete && checks.authenticated_reconnect===true && checks.comp_motion_exact_after_reconnect===true && checks.layer_motion_exact_after_reconnect===true && checks.comp_marker_exact_after_reconnect===true && checks.layer_marker_exact_after_reconnect===true && checks.post_reconnect_comp_mutation===true && checks.post_reconnect_marker_mutation===true && checks.saved_project_retained_after_cleanup===true;
    await writeJson(resultPath,{proofId:"M3_MARKER_MOTION_P5_REAL_AE",classification:p5?"PASS":"PRODUCT_FAILURE",status:p5?"ACCEPTED":"FAILURE",ok:p5,message:p5?"Marker/motion state survived save/reopen/distinct authenticated reconnect and accepted fresh post-reconnect mutations with proof-owned cleanup.":(failureError??cleanupErrors.join("; ")),startedAt,completedAt:new Date().toISOString(),proofLevels:{P1_validation_rejection:true,P2_structural_readback:true,P3_visual_proof:true,P4_failure_injection_rollback:true,P5_save_reopen_reconnect_transfer:p5},checks,initialSession,reconnectedSession,responses,failureError,cleanupErrors,cleanupComplete,artifacts:{savedProject:projectPath,reopenMarker:reopenMarkerPath,cleanupMarker:cleanupMarkerPath}});
    if(!p5)process.exitCode=1;
  }
};
main().catch((e)=>{console.error(e);process.exitCode=1;});
