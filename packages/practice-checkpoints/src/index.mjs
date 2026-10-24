/**
 * Practice checkpoint vault core. This module intentionally has NO Adobe/CEP writes.
 * AE lifecycle transitions must be performed by the authorized production owner.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROLES = new Set([
  'RAW_VIDEO', 'RAW_AUDIO', 'FINISHED_REFERENCE', 'AE_PROJECT',
  'SOURCE_MATCH_EVIDENCE', 'PROXY', 'RENDER', 'MASK', 'OTHER',
]);
const VERSION = 'editflow.practice.checkpoint.v1';
const JOURNAL = 'editflow.practice.experiment.v1';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const assertString = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
};
const ensureRecord = (value, name) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${name} must be an object`);
  return value;
};
const ensureJson = (value) => {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new TypeError('Snapshot metadata must be JSON serializable');
  return JSON.parse(json);
};
const vaultPath = (root, ...segments) => join(resolve(root), ...segments);

async function fileHash(path) {
  const fh = await open(path, 'r');
  try {
    const h = createHash('sha256');
    for await (const chunk of fh.createReadStream()) h.update(chunk);
    return h.digest('hex');
  } finally { await fh.close(); }
}

/** Fsync each experiment immediately, including failures and rejected proposals.
 * Optional preview/render evidence is archived NOW, not only when Save is clicked.
 * The sole production writer must serialize calls for one assignment.
 */
export async function recordPracticeExperiment({ vaultRoot, assignmentId, attempt, evidenceArtifacts = [] }) {
  assertString(assignmentId, 'assignmentId');
  ensureRecord(attempt, 'attempt');
  for (const field of ['attemptId', 'shotId', 'outcome']) assertString(attempt[field], `attempt.${field}`);
  if (!Array.isArray(attempt.effectStack)) throw new TypeError('attempt.effectStack must be an ordered array');
  if (!Array.isArray(evidenceArtifacts)) throw new TypeError('evidenceArtifacts must be an array');
  const dir = vaultPath(vaultRoot, 'journals');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sha(assignmentId)}.jsonl`);
  // Idempotent retry of the same attempt: never journal a second inconsistent version.
  let previous = [];
  try { previous = await readPracticeExperiments(path, assignmentId); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = previous.find((e) => e.attempt.attemptId === attempt.attemptId);
  if (existing) {
    if (JSON.stringify(existing.attempt) !== JSON.stringify(ensureJson(attempt))) {
      throw new Error(`Conflicting retry for attempt ${attempt.attemptId}`);
    }
    return { journalPath: path, evidence: existing.evidence, alreadyRecorded: true };
  }
  const evidence = [];
  for (const asset of evidenceArtifacts) evidence.push(await archiveArtifact(vaultRoot, asset));
  const event = {
    schema: JOURNAL, assignmentId, recordedAt: new Date().toISOString(),
    attempt: ensureJson(attempt), evidence,
  };
  const handle = await open(path, 'a');
  try { await handle.writeFile(JSON.stringify(event) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  return { journalPath: path, evidence, alreadyRecorded: false };
}

/** Detect incomplete/tampered journal lines; don't silently discard failed attempts. */
export async function readPracticeExperiments(journalPath, assignmentId) {
  assertString(assignmentId, 'assignmentId');
  const contents = await readFile(journalPath, 'utf8');
  if (contents && !contents.endsWith('\n')) throw new Error('Incomplete experiment journal: final record not committed');
  const events = contents.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (events.some((x) => x.schema !== JOURNAL || x.assignmentId !== assignmentId)) {
    throw new Error('Experiment journal does not match assignment');
  }
  return events;
}

async function archiveArtifact(vaultRoot, item) {
  assertString(item.logicalId, 'artifact.logicalId');
  assertString(item.path, 'artifact.path');
  if (!ROLES.has(item.role)) throw new TypeError(`Unknown artifact role: ${item.role}`);
  const statBefore = await lstat(item.path);
  if (!statBefore.isFile() || statBefore.isSymbolicLink()) throw new Error(`Artifact must be a regular non-symlink file: ${item.logicalId}`);
  const stageDir = vaultPath(vaultRoot, '.staging');
  const objectDir = vaultPath(vaultRoot, 'objects');
  await Promise.all([mkdir(stageDir, { recursive: true }), mkdir(objectDir, { recursive: true })]);
  const temp = join(stageDir, randomUUID());
  try {
    await copyFile(item.path, temp, constants.COPYFILE_EXCL);
    const statAfter = await lstat(item.path);
    const copied = await lstat(temp);
    if (statBefore.size !== statAfter.size || statBefore.mtimeMs !== statAfter.mtimeMs || copied.size !== statBefore.size) {
      throw new Error(`Artifact modified during checkpoint: ${item.logicalId}`);
    }
    const digest = await fileHash(temp);
    const objectPath = join(objectDir, digest);
    const handle = await open(temp, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    try { await link(temp, objectPath); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (await fileHash(objectPath) !== digest) throw new Error(`Object vault hash mismatch: ${item.logicalId}`);
    return { logicalId: item.logicalId, role: item.role, sha256: digest, bytes: copied.size, filename: item.filename ?? item.path.split(/[\\/]/).pop() };
  } finally { await unlink(temp).catch(() => {}); }
}

/**
 * Archive all referenced media/project/evidence BEFORE clearing anything.
 * quiesce: exclusive writer stops and flushes AE/project/journal, then supplies snapshot paths.
 * clearOwnedSession: deletes ONLY this assignment's temporary AE workspace after verification.
 * Neither callback is implemented here to prevent unauthorized AE mutation.
 */
export async function saveAndClearPractice({ vaultRoot, assignmentId, sessionId, quiesce, clearOwnedSession }) {
  assertString(assignmentId, 'assignmentId');
  assertString(sessionId, 'sessionId');
  if (typeof quiesce !== 'function' || typeof clearOwnedSession !== 'function') {
    throw new TypeError('Explicit authorized quiesce and clearOwnedSession callbacks are required');
  }
  const state = ensureRecord(await quiesce(), 'quiesce result');
  const artifacts = state.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('No checkpoint artifacts supplied');
  const roleSet = new Set(artifacts.map((x) => x.role));
  for (const role of ['AE_PROJECT', 'RAW_VIDEO', 'FINISHED_REFERENCE', 'EXPERIMENT_JOURNAL']) {
    if (!roleSet.has(role)) throw new Error(`Save blocked: missing ${role}`);
  }
  const ids = new Set();
  const savedAssets = [];
  for (const asset of artifacts) {
    if (ids.has(asset.logicalId)) throw new Error(`Duplicate artifact id ${asset.logicalId}`);
    ids.add(asset.logicalId);
    const normalized = asset.role === 'EXPERIMENT_JOURNAL' ? { ...asset, role: 'OTHER' } : asset;
    const saved = await archiveArtifact(vaultRoot, normalized);
    savedAssets.push({ ...saved, role: asset.role });
  }
  const journal = artifacts.find((x) => x.role === 'EXPERIMENT_JOURNAL');
  await readPracticeExperiments(journal.path, assignmentId);
  const journalSaved = savedAssets.find((x) => x.role === 'EXPERIMENT_JOURNAL');
  if (await fileHash(journal.path) !== journalSaved.sha256) {
    throw new Error('Experiment journal changed during checkpoint; clearing is forbidden');
  }
  const snapshotId = randomUUID();
  const manifest = {
    schema: VERSION, snapshotId, assignmentId, sessionId,
    savedAt: new Date().toISOString(),
    state: ensureJson(state.resumeState),
    artifacts: savedAssets,
  };
  const snapshotsDir = vaultPath(vaultRoot, 'snapshots');
  await mkdir(snapshotsDir, { recursive: true });
  const tempManifest = vaultPath(vaultRoot, '.staging', `${snapshotId}.json`);
  const finalManifest = join(snapshotsDir, `${snapshotId}.json`);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const handle = await open(tempManifest, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(tempManifest, finalManifest);
  // Proof gate: verifies full backup by rereading every object's bytes.
  await verifyPracticeSnapshot({ vaultRoot, snapshotId });
  try {
    await clearOwnedSession({ assignmentId, sessionId, snapshotId, manifestPath: finalManifest });
    return { snapshotId, manifestPath: finalManifest, status: 'SAVED_AND_CLEARED' };
  } catch (error) {
    return { snapshotId, manifestPath: finalManifest, status: 'SAVED_CLEAR_FAILED', clearError: String(error) };
  }
}

/** Verified read-only snapshot. A corrupt/missing object blocks resume. */
export async function verifyPracticeSnapshot({ vaultRoot, snapshotId }) {
  if (!/^[0-9a-f-]{36}$/.test(snapshotId)) throw new TypeError('Invalid snapshot id');
  const path = vaultPath(vaultRoot, 'snapshots', `${snapshotId}.json`);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schema !== VERSION || manifest.snapshotId !== snapshotId) throw new Error('Checkpoint schema/id mismatch');
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw new Error('Checkpoint has no assets');
  for (const item of manifest.artifacts) {
    if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid object hash');
    const objectPath = vaultPath(vaultRoot, 'objects', item.sha256);
    if ((await lstat(objectPath)).size !== item.bytes || await fileHash(objectPath) !== item.sha256) {
      throw new Error(`Checkpoint artifact corrupt: ${item.logicalId}`);
    }
    if (item.role === 'EXPERIMENT_JOURNAL') {
      const events = await readPracticeExperiments(objectPath, manifest.assignmentId);
      for (const event of events) {
        for (const evidence of event.evidence ?? []) {
          if (!/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '')) throw new Error('Invalid visual evidence hash');
          const evidencePath = vaultPath(vaultRoot, 'objects', evidence.sha256);
          if ((await lstat(evidencePath)).size !== evidence.bytes || await fileHash(evidencePath) !== evidence.sha256) {
            throw new Error(`Experiment evidence corrupt: ${evidence.logicalId}`);
          }
        }
      }
    }
  }
  return manifest;
}

/** Rehydrate backed-up artifacts into a NEW workspace. Host then reopens AE and rebinds media. */
export async function materializePracticeSnapshot({ vaultRoot, snapshotId, destination }) {
  const manifest = await verifyPracticeSnapshot({ vaultRoot, snapshotId });
  await mkdir(destination); // Reject existing paths to avoid overwriting unrelated work.
  const restored = [];
  for (const [index, asset] of manifest.artifacts.entries()) {
    // Never trust recorded filenames for paths; use ordinal/hash while preserving extension.
    const extension = extname(asset.filename ?? '').slice(0, 12).replace(/[^.a-z0-9]/gi, '');
    const path = join(destination, `${index}-${asset.sha256.slice(0, 12)}${extension}`);
    await copyFile(vaultPath(vaultRoot, 'objects', asset.sha256), path, constants.COPYFILE_EXCL);
    if (await fileHash(path) !== asset.sha256) throw new Error(`Restored artifact corrupt: ${asset.logicalId}`);
    restored.push({ logicalId: asset.logicalId, role: asset.role, path, sha256: asset.sha256 });
  }
  const journal = restored.find((item) => item.role === 'EXPERIMENT_JOURNAL');
  const restoredEvidence = [];
  if (journal) {
    const events = await readPracticeExperiments(journal.path, manifest.assignmentId);
    const evidenceFolder = join(destination, 'experiment-evidence');
    await mkdir(evidenceFolder);
    for (const event of events) {
      for (const evidence of event.evidence ?? []) {
        const extension = extname(evidence.filename ?? '').slice(0, 12).replace(/[^.a-z0-9]/gi, '');
        const path = join(evidenceFolder, `${evidence.sha256}${extension}`);
        try { await copyFile(vaultPath(vaultRoot, 'objects', evidence.sha256), path, constants.COPYFILE_EXCL); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        restoredEvidence.push({ attemptId: event.attempt.attemptId, logicalId: evidence.logicalId, path, sha256: evidence.sha256 });
      }
    }
  }
  return { manifest, restored, restoredEvidence };
}
