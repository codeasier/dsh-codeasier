import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { openReviewStore, type ReviewStore } from '../src/store.js';
import { parseRecord, type RunRecord } from '../src/records.js';
import { prepareEvidence } from '../src/evidence.js';

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()); const scratch = await realpath(await mkdtemp(join(parent, 'dsh-store-test-')));
  const root = join(scratch, 'repo'); const ownershipRoot = join(scratch, 'store'); await mkdir(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
  git('init', '-q'); await writeFile(join(root, 'main.ts'), 'export const STORE_EVIDENCE = true;\n'); git('add', 'main.ts'); git('commit', '-qm', 'fixture');
  const snapshot = await prepareEvidence({ kind: 'local', root }); const ctx = new Context(); const stores: ReviewStore[] = [];
  t.after(async () => {
    for (const store of stores) await store.close().catch(() => {}); await ctx.fiber.dispose();
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), parent); assert.ok(basename(scratch).startsWith('dsh-store-test-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  await ctx.plugin(Storage);
  async function open() { const store = await openReviewStore(ctx, ownershipRoot); stores.push(store); return store; }
  function record(): RunRecord {
    const now = Date.now(); return parseRecord({
      id: randomUUID(), revision: 0, schemaVersion: 1, policyVersion: 1,
      owner: { sessionId: 'store-parent', project: root, runtimeId: randomUUID() },
      config: { reviewers: [{ id: 'a', provider: 'offline', model: 'a', focus: 'safety' }], concurrency: 1, timeoutMs: 10_000, judge: { kind: 'parent' } }, sources: { reviewers: 'fixture' }, snapshot,
      state: 'running', attempts: [{ id: randomUUID(), reviewerId: 'a', provider: 'offline', model: 'a', kind: 'reviewer', state: 'pending' }], decisions: [],
      authorization: { digest: 'a'.repeat(64), mode: 'interactive', outcome: 'allowed-once', approvedAt: now, approvalPolicy: 'ask' },
      cancellationIntent: false, deadline: now + 10_000, createdAt: now, updatedAt: now, audit: [{ at: now, action: 'created', detail: 'offline fixture' }],
    });
  }
  return { ctx, scratch, root, ownershipRoot, snapshot, open, record };
}
function transition(current: RunRecord, change: (next: RunRecord) => void = () => {}): RunRecord {
  const next = structuredClone(current); next.revision++; next.updatedAt++; change(next); return next;
}

test('native JSON store durably restores immutable evidence, bindings and confirmed terminal results', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const store = await f.open(); const initial = f.record(); await store.put(initial);
  const completed = await store.update(initial.id, current => transition(current, next => {
    next.state = 'completed'; const attempt = next.attempts[0]!;
    Object.assign(attempt, { state: 'completed', childId: 'confirmed-child', controllerId: 'confirmed-controller', snapshotId: f.snapshot.id, result: { findings: [] } });
  }));
  await store.close(); assert.throws(() => store.get(initial.id), /closed/);
  const reopened = await f.open(); const restored = reopened.get(initial.id)!;
  assert.deepEqual(restored, completed); assert.ok(Object.isFrozen(restored)); assert.ok(Object.isFrozen(restored.snapshot.files));
  assert.equal(restored.attempts[0]?.childId, 'confirmed-child'); assert.deepEqual(restored.attempts[0]?.result, { findings: [] });
  await assert.rejects(reopened.put(restored), /already exists/);
  assert.equal(await reopened.delete(initial.id), true); assert.equal(await reopened.delete(initial.id), false);
  await reopened.close(); const empty = await f.open(); assert.deepEqual(empty.list(), []);
});

test('store update serializes competing stale revisions and rolls back rejected immutable changes', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const store = await f.open(); const initial = f.record(); await store.put(initial);
  const outcomes = await Promise.allSettled([1, 2].map(() => store.update(initial.id, current => {
    if (current.revision !== initial.revision) throw new Error('Stale control revision');
    return transition(current, next => { next.audit.push({ at: next.updatedAt, action: 'decision', detail: 'one authorized control' }); });
  })));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal(store.get(initial.id)?.revision, 1); assert.equal(store.get(initial.id)?.audit.filter(a => a.action === 'decision').length, 1);
  for (const mutate of [
    (r: RunRecord) => { r.id = randomUUID(); }, (r: RunRecord) => { r.revision += 1; },
    (r: RunRecord) => { r.owner.sessionId = 'intruder'; }, (r: RunRecord) => { r.owner.project = '/outside'; },
    (r: RunRecord) => { r.config.reviewers[0]!.model = 'replacement'; },
    (r: RunRecord) => { r.attempts[0]!.state = 'completed'; },
  ]) {
    const before = JSON.stringify(store.get(initial.id));
    await assert.rejects(store.update(initial.id, current => transition(current, mutate)));
    assert.equal(JSON.stringify(store.get(initial.id)), before, 'failed transaction must not leak mutations');
  }
});

test('native record parsing rejects duplicate child IDs, false completion, bad schema and snapshot tampering', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const initial = f.record();
  for (const mutate of [
    (r: any) => { r.snapshot.files['main.ts'] = 'tampered'; },
    (r: any) => { r.schemaVersion = 2; }, (r: any) => { r.state = 'completed'; },
    (r: any) => { r.attempts[0].state = 'completed'; r.attempts[0].result = { findings: [] }; },
    (r: any) => { r.attempts[0].childId = 'child'; r.attempts[0].controllerId = 'controller'; r.attempts[0].snapshotId = 'wrong'; },
    (r: any) => { r.attempts.push({ ...r.attempts[0] }); },
  ]) { const copy = structuredClone(initial); mutate(copy); assert.throws(() => parseRecord(copy)); }
});

test('tampered snapshot bytes in the owned durable JSON fail open before any recovery', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const store = await f.open(); const record = f.record(); await store.put(record); await store.close();
  const jsonFiles = (await readdir(f.ownershipRoot)).filter(name => name.endsWith('.json')); assert.equal(jsonFiles.length, 1);
  const path = join(f.ownershipRoot, jsonFiles[0]!); const document: unknown = JSON.parse(await readFile(path, 'utf8'));
  let changed = 0;
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.id === record.id && node.snapshot?.files) { node.snapshot.files['main.ts'] = 'tampered durable bytes'; changed++; }
    for (const child of Object.values(node)) visit(child);
  };
  visit(document); assert.equal(changed, 1); await writeFile(path, JSON.stringify(document));
  await assert.rejects(f.open(), /snapshot|hash|Evidence|schema/i);
});

test('exact ownership-root lock excludes independent processes and releases cleanly', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const helper = fileURLToPath(new URL('./helpers/store-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', helper, f.ownershipRoot], { cwd: resolve(fileURLToPath(new URL('..', import.meta.url))), stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let error = '';
  child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { error += String(chunk); });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const opened = new Promise<void>((resolveOpened, reject) => {
    child.stdout.on('data', () => { if (output.includes('opened\n')) resolveOpened(); });
    child.once('exit', code => { if (!output.includes('opened\n')) reject(new Error(`Worker startup failed (${code}): ${error}`)); });
  });
  await opened;
  await assert.rejects(f.open(), /lock|timeout|busy|held/i);
  const exited = once(child, 'exit'); child.stdin.end('close\n'); const [code] = await exited;
  assert.equal(code, 0, error); assert.match(output, /closed/);
  const store = await f.open(); const record = f.record(); await store.put(record); assert.equal(store.get(record.id)?.snapshot.id, f.snapshot.id);
});

test('ownership root rejects relative and symlink traversal before cached domain use', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(openReviewStore(f.ctx, 'relative-store'), /absolute/);
  const real = join(f.scratch, 'actual'); await mkdir(real); const linked = join(f.scratch, 'linked'); await symlink(real, linked);
  await assert.rejects(openReviewStore(f.ctx, linked), /symlink/);
});
