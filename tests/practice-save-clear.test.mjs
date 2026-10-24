import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordPracticeExperiment, readPracticeExperiments,
  saveAndClearPractice, verifyPracticeSnapshot, materializePracticeSnapshot,
} from '../packages/practice-checkpoints/src/index.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ef-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'source'));
  const video = join(root, 'source', 'raw.mov');
  const finished = join(root, 'source', 'finished.mp4');
  const aep = join(root, 'source', 'edit.aep');
  await Promise.all([
    writeFile(video, 'raw video bytes'),
    writeFile(finished, 'finished video bytes'),
    writeFile(aep, 'AfterEffects project state with effects'),
  ]);
  const { journalPath } = await recordPracticeExperiment({
    vaultRoot: root, assignmentId: 'assignment:123',
    attempt: {
      attemptId: 'shot-1-a', shotId: 'shot-001', outcome: 'REJECTED',
      effectStack: [{
        matchName: 'ADBE Motion Blur',
        parameters: { direction: 0, length: 24 }, keyframes: [],
      }],
      metrics: { lpips: 0.67 }, renderedFrameHashes: ['abc'],
      reason: 'Wrong motion direction',
    },
  });
  return {
    root, video, finished, aep, journalPath,
    assets: [
      { logicalId: 'video', role: 'RAW_VIDEO', path: video },
      { logicalId: 'finished', role: 'FINISHED_REFERENCE', path: finished },
      { logicalId: 'project', role: 'AE_PROJECT', path: aep },
      { logicalId: 'journal', role: 'EXPERIMENT_JOURNAL', path: journalPath },
    ],
  };
}

const input = (f, callbacks = {}) => ({
  vaultRoot: f.root, assignmentId: 'assignment:123', sessionId: 'practice:abc',
  quiesce: async () => ({
    resumeState: {
      stage: 'EFFECTS', shotId: 'shot-001',
      committedOperations: ['op-12'], status: 'PAUSED',
    },
    artifacts: f.assets,
  }),
  clearOwnedSession: async () => {},
  ...callbacks,
});

test('backs up AE, media and rejected trials before clearing; restores bytes', async (t) => {
  const f = await fixture(t);
  let cleared = false;
  const saved = await saveAndClearPractice(input(f, {
    clearOwnedSession: async () => { cleared = true; },
  }));
  assert.equal(saved.status, 'SAVED_AND_CLEARED');
  assert.equal(cleared, true);
  const manifest = await verifyPracticeSnapshot({
    vaultRoot: f.root, snapshotId: saved.snapshotId,
  });
  assert.equal(manifest.artifacts.length, 4);
  assert.deepEqual(manifest.state.committedOperations, ['op-12']);
  const recovered = await materializePracticeSnapshot({
    vaultRoot: f.root, snapshotId: saved.snapshotId,
    destination: join(f.root, 'restored'),
  });
  assert.equal(recovered.restored.length, 4);
  const project = recovered.restored.find((x) => x.role === 'AE_PROJECT');
  assert.equal(await readFile(project.path, 'utf8'),
    'AfterEffects project state with effects');
  const journal = recovered.restored.find((x) => x.role === 'EXPERIMENT_JOURNAL');
  const attempts = await readPracticeExperiments(journal.path, 'assignment:123');
  assert.equal(attempts[0].attempt.outcome, 'REJECTED');
  assert.equal(attempts[0].attempt.effectStack[0].parameters.length, 24);
});

test('missing critical asset blocks clear', async (t) => {
  const f = await fixture(t);
  let clears = 0;
  f.assets.splice(1, 1);
  await assert.rejects(() => saveAndClearPractice(input(f, {
    clearOwnedSession: async () => { clears++; },
  })), /missing FINISHED_REFERENCE/);
  assert.equal(clears, 0);
});

test('AE cleanup failure never invalidates a verified saved checkpoint', async (t) => {
  const f = await fixture(t);
  const result = await saveAndClearPractice(input(f, {
    clearOwnedSession: async () => { throw new Error('AE busy'); },
  }));
  assert.equal(result.status, 'SAVED_CLEAR_FAILED');
  assert.match(result.clearError, /AE busy/);
  await verifyPracticeSnapshot({ vaultRoot: f.root, snapshotId: result.snapshotId });
});

test('corrupt object blocks resume', async (t) => {
  const f = await fixture(t);
  const saved = await saveAndClearPractice(input(f));
  const manifest = await verifyPracticeSnapshot({
    vaultRoot: f.root, snapshotId: saved.snapshotId,
  });
  await writeFile(join(f.root, 'objects', manifest.artifacts[0].sha256), 'CORRUPT');
  await assert.rejects(() => materializePracticeSnapshot({
    vaultRoot: f.root, snapshotId: saved.snapshotId,
    destination: join(f.root, 'out'),
  }), /corrupt/);
});

test('attempts survive before Save & Clear is pressed', async (t) => {
  const f = await fixture(t);
  const events = await readPracticeExperiments(f.journalPath, 'assignment:123');
  assert.equal(events[0].attempt.reason, 'Wrong motion direction');
});

test('rendered fingerprints survive cancellation and retries are idempotent', async (t) => {
  const f = await fixture(t);
  const preview = join(f.root, 'source', 'shot-1-b.png');
  await writeFile(preview, 'render evidence');
  const attempt = {
    attemptId: 'shot-1-b', shotId: 'shot-001', outcome: 'FAILED',
    effectStack: [{ matchName: 'ADBE Glo2',
      parameters: { intensity: 1.4 }, keyframes: [{ frame: 0, value: 1.4 }] }],
    comparison: { score: 0.32, diagnosis: 'Overexposed' },
  };
  const first = await recordPracticeExperiment({
    vaultRoot: f.root, assignmentId: 'assignment:123', attempt,
    evidenceArtifacts: [{ logicalId: 'render-b', role: 'RENDER', path: preview }],
  });
  await rm(preview);
  assert.equal(await readFile(join(f.root, 'objects', first.evidence[0].sha256), 'utf8'), 'render evidence');
  const retry = await recordPracticeExperiment({
    vaultRoot: f.root, assignmentId: 'assignment:123', attempt,
  });
  assert.equal(retry.alreadyRecorded, true);
  assert.equal((await readPracticeExperiments(f.journalPath, 'assignment:123')).length, 2);
});

test('conflicting effects cannot silently overwrite a prior attempt', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => recordPracticeExperiment({
    vaultRoot: f.root, assignmentId: 'assignment:123',
    attempt: { attemptId: 'shot-1-a', shotId: 'shot-001',
      outcome: 'ACCEPTED', effectStack: [] },
  }), /Conflicting retry/);
});

test('visual evidence is included when a saved run is later restored', async (t) => {
  const f = await fixture(t);
  const preview = join(f.root, 'source', 'shot-1-b.png');
  await writeFile(preview, 'frame from experiment');
  await recordPracticeExperiment({
    vaultRoot: f.root, assignmentId: 'assignment:123',
    attempt: {
      attemptId: 'shot-1-b', shotId: 'shot-001',
      outcome: 'REJECTED', effectStack: [], diagnosis: 'Mismatch',
    },
    evidenceArtifacts: [{ logicalId: 'render-b', role: 'RENDER', path: preview }],
  });
  const result = await saveAndClearPractice(input(f));
  await rm(preview);
  const restored = await materializePracticeSnapshot({
    vaultRoot: f.root, snapshotId: result.snapshotId,
    destination: join(f.root, 'restore-fingerprint'),
  });
  assert.equal(restored.restoredEvidence.length, 1);
  assert.equal(restored.restoredEvidence[0].attemptId, 'shot-1-b');
  assert.equal(await readFile(restored.restoredEvidence[0].path, 'utf8'), 'frame from experiment');
});
