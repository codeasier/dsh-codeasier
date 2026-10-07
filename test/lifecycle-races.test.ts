import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import Storage from '@deepseek-ai/dsh-storage';
import Approval from '@deepseek-ai/dsh-user-approval';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { CrossReviewService, type ReviewPlan } from '../src/service.js';
import { NativeReviewerDriver, type NativeAttemptInput } from '../src/native-driver.js';
import { openReviewStore, type ReviewStore } from '../src/store.js';
import { parseRecord, type RunRecord } from '../src/records.js';
import { prepareEvidence } from '../src/evidence.js';
import { REVIEWER_SCHEMA, type ReviewConfig } from '../src/protocol.js';
import { canonicalFindingId } from '../src/judge.js';

function barrier<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject };
}
type Call = { name: string; args: unknown };
type Script = (request: GenerateOptions) => readonly Call[] | Promise<readonly Call[]>;
class Offline extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  constructor(readonly script: Script) { super(); }
  override providerInfo(id: string) { return { id, name: 'Lifecycle fixture, offline' }; }
  override async listModels(provider: string) { return ['owner', 'a', 'b', 'c', 'judge', 'fallback'].map(id => ({ provider, id, name: id })); }
  override async resolveModel(provider: string, id: string) { return { provider, id, name: id }; }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options); const calls = await this.script(options);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call' as const, id: ToolCallId(`race-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}
const candidate = { id: 'local', title: 'Fixture candidate', body: 'Must be independently judged.', severity: 'high' as const, path: 'main.ts', startLine: 1, endLine: 1, quote: 'export const RACE = 1;' };
const reviews = [{ name: 'structured_output', args: { findings: [candidate] } }];
const empty = [{ name: 'structured_output', args: { findings: [] } }];
const verdict = { findingId: canonicalFindingId(candidate), verdict: 'verified', reason: 'Checked immutable source.', severity: 'medium' };
function settings(overrides: Partial<ReviewConfig> = {}): ReviewConfig { return { reviewers: [{ id: 'a', provider: 'offline', model: 'a', focus: 'correctness' }], concurrency: 1, timeoutMs: 5000, judge: { kind: 'parent' }, ...overrides }; }
function until(service: CrossReviewService, predicate: (r: RunRecord) => boolean) {
  const done = barrier<RunRecord>(); const stop = service.subscribe(r => { if (predicate(r)) { stop(); done.resolve(r); } }); return done.promise;
}
async function waitForAbort(signal: AbortSignal | undefined): Promise<readonly Call[]> {
  assert.ok(signal);
  return new Promise((_resolve, reject) => { const cancel = () => reject(signal.reason ?? new Error('cancelled')); if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true }); });
}
async function fixture(t: TestContext, script: Script = () => empty) {
  const temp = await realpath(tmpdir()); const scratch = await realpath(await mkdtemp(join(temp, 'dsh-races-'))); const root = join(scratch, 'repo'); await mkdir(root);
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, env: environment, stdio: 'pipe' });
  git('init', '-q'); await writeFile(join(root, 'main.ts'), candidate.quote + '\n'); git('add', 'main.ts'); git('commit', '-qm', 'fixture');
  const ctx = new Context(); await mountAgentLoopTestDependencies(ctx); await ctx.plugin(Storage); await ctx.plugin(Approval, { policy: 'ask' });
  let planId: string | undefined;
  const adapter = new Offline(options => options.model === 'owner' ? (planId ? (() => { const id = planId; planId = undefined; return [{ name: 'cross_review_start', args: { planId: id } }]; })() : []) : script(options));
  ctx.llm.registerAdapter(['offline'], adapter); await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 8 }); await ctx.plugin(Spawn, { providerName: 'spawn' });
  const parentHandle = await ctx.agents.create({ sessionId: SessionId('race-owner'), agentOptions: { provider: 'offline', model: 'owner' }, meta: { cwd: root } });
  const parent = parentHandle.agent; const storeRoot = join(scratch, 'store'); const nativeStore = await openReviewStore(ctx, storeRoot);
  let updateHook: ((id: string, transform: (r: RunRecord) => RunRecord, next: () => Promise<RunRecord>) => Promise<RunRecord>) | undefined;
  let closeCalls = 0;
  const store: ReviewStore = { ...nativeStore, update(id, transform) { return updateHook ? updateHook(id, transform, () => nativeStore.update(id, transform)) : nativeStore.update(id, transform); }, close() { closeCalls++; return nativeStore.close(); } };
  const service = new CrossReviewService(ctx, store, { configurationHome: scratch }); const additionalStores: ReviewStore[] = [];
  t.after(async () => {
    await service.dispose().catch(() => {}); for (const s of additionalStores) await s.close().catch(() => {});
    await parentHandle.dispose(); await ctx.fiber.dispose();
    assert.equal(dirname(scratch), temp); assert.ok(basename(scratch).startsWith('dsh-races-')); assert.equal(await realpath(scratch), scratch); await rm(scratch, { recursive: true, force: true });
  });
  async function preview(config = settings()) { return service.preview(parent, { kind: 'local', root }, [{ source: 'race-fixture', value: config }]); }
  async function drive(plan: ReviewPlan) {
    const result = barrier<{ ok: boolean; runId?: string; message?: string }>();
    const stop = ctx.on('tools/result', (exec, outcome) => {
      if (exec.agent !== parent || exec.name !== 'cross_review_start') return undefined;
      stop(); result.resolve(outcome.isError ? { ok: false, message: outcome.error.message } : { ok: true, runId: (outcome.value as { runId: string }).runId }); return undefined;
    });
    planId = plan.id; parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start frozen test plan.' }], source: { kind: 'user' } }));
    try { return await result.promise; } finally { stop(); await parent.whenIdle(); }
  }
  function approve() { return parent.ctx.on('approval/request', async () => 'allowed-once'); }
  async function reopen() { const s = await openReviewStore(ctx, storeRoot); additionalStores.push(s); return s; }
  return { ctx, adapter, parent, parentHandle, service, nativeStore, root, storeRoot, preview, drive, approve, reopen,
    closeCalls: () => closeCalls, setUpdateHook(hook: typeof updateHook) { updateHook = hook; }, calls: () => adapter.calls.filter(c => c.model !== 'owner') };
}

function completedRecord(snapshot: Awaited<ReturnType<typeof prepareEvidence>>, root: string): RunRecord {
  const now = Date.now(); return {
    id: randomUUID(), revision: 0, schemaVersion: 1, policyVersion: 1,
    owner: { sessionId: 'race-owner', project: root, runtimeId: randomUUID() }, config: settings(), sources: {}, snapshot,
    state: 'completed', attempts: [{ id: randomUUID(), reviewerId: 'a', provider: 'offline', model: 'a', kind: 'reviewer', state: 'completed', childId: 'old-child', controllerId: 'old-controller', snapshotId: snapshot.id, result: { findings: [candidate] } }], decisions: [],
    authorization: { digest: 'a'.repeat(64), mode: 'interactive', outcome: 'allowed-once', approvedAt: now, approvalPolicy: 'ask' }, cancellationIntent: false, deadline: now + 5000, createdAt: now, updatedAt: now, audit: [],
  };
}

test('durable completed records must reject still-pending independent judgment', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const record = completedRecord(await prepareEvidence({ kind: 'local', root: f.root }), f.root);
  assert.throws(() => parseRecord(record), /pending|judg|completion/i);
});

test('repeated attempts for one reviewer cannot manufacture completed quorum', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const record = completedRecord(await prepareEvidence({ kind: 'local', root: f.root }), f.root);
  record.config = settings({ reviewers: ['a', 'b', 'c'].map(id => ({ id, provider: 'offline', model: id, focus: 'correctness' })) });
  record.decisions = [{ ...verdict, verdict: 'verified', severity: 'medium' }];
  record.attempts.push({ ...record.attempts[0]!, id: randomUUID(), childId: 'second-a-child', controllerId: 'second-a-controller' });
  assert.throws(() => parseRecord(record), /reviewer|quorum|duplicate/i);
});

test('durable model-judge completion must match the exact configured judge route', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const record = completedRecord(await prepareEvidence({ kind: 'local', root: f.root }), f.root);
  record.config = settings({ judge: { kind: 'model', provider: 'offline', model: 'judge' } });
  record.decisions = [{ ...verdict, verdict: 'verified', severity: 'medium' }];
  record.attempts.push({ id: randomUUID(), reviewerId: 'judge', provider: 'offline', model: 'fallback', kind: 'judge', state: 'completed', childId: 'fallback-judge-child', controllerId: 'fallback-controller', snapshotId: record.snapshot.id, decisions: record.decisions });
  assert.throws(() => parseRecord(record), /judge|route|model/i);
});

test('durable records reject unsupported schema and policy versions', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const record = completedRecord(await prepareEvidence({ kind: 'local', root: f.root }), f.root); record.decisions = [{ ...verdict, verdict: 'verified', severity: 'medium' }];
  for (const field of ['schemaVersion', 'policyVersion']) assert.throws(() => parseRecord({ ...record, [field]: 2 }));
});

test('disposal cancels a pending native approval and admits zero reviewers', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const entered = barrier(); let cancelled = false;
  f.parent.ctx.on('approval/request', async request => { entered.resolve(); try { await waitForAbort(request.signal); } catch { cancelled = true; } return 'rejected'; });
  const starting = f.drive(await f.preview()); await entered.promise; await f.service.dispose(); const outcome = await starting;
  assert.equal(outcome.ok, false); assert.equal(cancelled, true); assert.equal(f.calls().length, 0);
  const store = await f.reopen(); assert.deepEqual(store.list(), []);
});

test('disposal after startup body but before authoritative result retains no live running receipt', { timeout: 15_000 }, async t => {
  const f = await fixture(t); f.approve(); const entered = barrier(); const release = barrier();
  f.parent.ctx.on('tools/post-execute', async (exec, _result, next) => {
    if (exec.name !== 'cross_review_start') return next();
    await Promise.resolve(); entered.resolve(); await release.promise; return next();
  });
  const starting = f.drive(await f.preview()); await entered.promise;
  const disposing = f.service.dispose();
  // The spy's invocation is synchronous: disposal must not close durable storage
  // while an owned startup has not produced its authoritative tools/result.
  const closedBeforeResult = f.closeCalls(); release.resolve(); const [outcome] = await Promise.all([starting, disposing]);
  assert.equal(f.calls().length, 0);
  const store = await f.reopen(); const records = store.list();
  assert.equal(closedBeforeResult, 0, 'startup finalization is part of disposal quiescence');
  assert.ok(records.every(r => r.state === 'interrupted' || r.state === 'cancelled'), `staged startup remains ${records.map(r => r.state).join(',')} after disposal`);
  assert.equal(outcome.ok, false, 'disposed startup must not return an admitted running receipt');
});

test('host request routing cannot replace the authorized native model', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const snapshot = await prepareEvidence({ kind: 'local', root: f.root });
  f.ctx.on('agent/request', async (payload, next) => { const config = await next(); return payload.agent.session.header.parentSession?.startsWith('cross-review-controller-') ? { ...config, model: 'fallback' } : config; });
  const driver = new NativeReviewerDriver(f.ctx);
  const attempt = await driver.start({ owner: f.parent, attemptId: 'route-replacement', provider: 'offline', model: 'a', snapshot, prompt: 'Immutable route.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async () => {} });
  try { assert.notEqual((await attempt.result).stopReason, 'completed'); assert.equal(f.calls().length, 0); } finally { await attempt.dispose(); }
});

test('caller mutation during binding cannot redefine the authorized model contract', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const snapshot = await prepareEvidence({ kind: 'local', root: f.root });
  f.ctx.on('agent/request', async (payload, next) => { const config = await next(); return payload.agent.session.header.parentSession?.startsWith('cross-review-controller-') ? { ...config, model: 'fallback' } : config; });
  const input: NativeAttemptInput = { owner: f.parent, attemptId: 'mutable-route', provider: 'offline', model: 'a', snapshot, prompt: 'Original a route only.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async () => { input.model = 'fallback'; } };
  const attempt = await new NativeReviewerDriver(f.ctx).start(input);
  try { const result = await attempt.result; assert.equal(f.calls().length, 0, 'fallback may not reach the adapter'); assert.notEqual(result.stopReason, 'completed'); } finally { await attempt.dispose(); }
});

test('host request mutation cannot widen the explicitly authorized output-token cap', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const snapshot = await prepareEvidence({ kind: 'local', root: f.root });
  f.ctx.on('agent/request', async (payload, next) => { const config = await next(); return payload.agent.session.header.parentSession?.startsWith('cross-review-controller-') ? { ...config, maxTokens: 9000 } : config; });
  const attempt = await new NativeReviewerDriver(f.ctx).start({ owner: f.parent, attemptId: 'cap-replacement', provider: 'offline', model: 'a', maxTokens: 100, snapshot, prompt: 'Explicit cap 100.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async () => {} });
  try { const result = await attempt.result; assert.equal(f.calls().length, 0, 'widened output budget may not reach the adapter'); assert.notEqual(result.stopReason, 'completed'); } finally { await attempt.dispose(); }
});

test('disposing the exact owning parent drains active descendants and launches no replacement', { timeout: 15_000 }, async t => {
  const entered = barrier(); const f = await fixture(t, options => { entered.resolve(); return waitForAbort(options.signal); }); f.approve();
  const finished = until(f.service, r => r.state === 'failed' || r.state === 'interrupted' || r.state === 'cancelled');
  const receipt = await f.drive(await f.preview(settings({ reviewers: ['a', 'b'].map(id => ({ id, provider: 'offline', model: id, focus: 'safety' })) })));
  assert.equal(receipt.ok, true); await entered.promise; await f.parentHandle.dispose();
  assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id), [], 'disposing the owner must drain its exact native descendants');
  const record = await finished; assert.notEqual(record.state, 'completed'); assert.equal(f.calls().length, 1);
});

test('judge completion queued across timeout cannot bypass the pending timeout decision', { timeout: 15_000 }, async t => {
  const f = await fixture(t, options => options.model === 'judge' ? [{ name: 'structured_output', args: { decisions: [verdict] } }] : reviews); f.approve();
  const completionEntered = barrier(); const release = barrier(); let held = false;
  f.setUpdateHook(async (id, transform, next) => {
    const candidate = transform(f.nativeStore.get(id)!);
    if (!held && candidate.audit.at(-1)?.action === 'attempt_completed' && candidate.attempts.some(a => a.kind === 'judge' && a.state === 'completed')) {
      held = true; completionEntered.resolve(); await release.promise;
    }
    return next();
  });
  const timed = until(f.service, r => r.audit.at(-1)?.action === 'timeout_decision_pending');
  const stopped = until(f.service, r => r.audit.at(-1)?.action === 'timeout_work_stopped');
  const starting = f.drive(await f.preview(settings({ timeoutMs: 750, judge: { kind: 'model', provider: 'offline', model: 'judge' } })));
  await completionEntered.promise; await timed; release.resolve(); await starting; const record = await stopped;
  assert.equal(record.state, 'awaiting_timeout'); assert.equal((await f.service.report(f.parent, record.id)).complete, false);
  const count = f.calls().length; const preserved = await f.service.decideTimeout(f.parent, { runId: record.id, expectedRevision: record.revision }, 'preserve');
  assert.ok(['completed', 'interrupted'].includes(preserved.state)); assert.equal(f.calls().length, count);
});

test('recovery of attempted model judgment classifies unknown work interrupted, never paid retry', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const snapshot = await prepareEvidence({ kind: 'local', root: f.root }); const record = completedRecord(snapshot, f.root);
  record.state = 'awaiting_judge'; record.config = settings({ judge: { kind: 'model', provider: 'offline', model: 'judge' } });
  record.attempts.push({ id: randomUUID(), reviewerId: 'judge', provider: 'offline', model: 'judge', kind: 'judge', state: 'running', childId: 'old-judge', controllerId: 'old-judge-controller', snapshotId: snapshot.id });
  await f.nativeStore.put(parseRecord(record)); await f.service.recover();
  const recovered = await f.service.status(f.parent, record.id); const report = await f.service.report(f.parent, record.id);
  assert.equal(f.calls().length, 0); assert.equal(report.complete, false); assert.equal(recovered.attempts.find(a => a.kind === 'judge')?.state, 'interrupted');
  assert.equal(recovered.state, 'interrupted', 'a model judge cannot remain falsely awaiting a resident model turn');
});

test('unrelated unscoped native model requests proceed while controller creation is awaiting initialization', { timeout: 15_000 }, async t => {
  const f = await fixture(t, request => request.model === 'fallback' ? [] : empty);
  const snapshot = await prepareEvidence({ kind: 'local', root: f.root });
  const controllerEntered = barrier<string>(); const releaseController = barrier(); let bindingCount = 0;
  const stop = f.ctx.on('agent/created', async ({ agent }) => {
    if (!agent.session.id.startsWith('cross-review-controller-') || !f.ctx.agents.isOwnedBy(agent.session.id, f.parent)) return undefined;
    controllerEntered.resolve(agent.session.id); await releaseController.promise; return undefined;
  });
  const starting = new NativeReviewerDriver(f.ctx).start({ owner: f.parent, attemptId: 'unscoped-during-controller', provider: 'offline', model: 'a', snapshot,
    prompt: 'Review after administrative initialization.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async () => { bindingCount++; } });
  void starting.catch(() => {});
  try {
    const controllerId = await controllerEntered.promise;
    assert.equal(bindingCount, 0, 'no native reviewer identity has been bound yet');
    assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id).sort(), [f.parent.session.id, controllerId].sort());
    const chunks: StreamChunk[] = [];
    for await (const chunk of f.ctx.llm.stream({ provider: 'offline', model: 'fallback', messages: [], signal: new AbortController().signal })) chunks.push(chunk);
    assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'));
    assert.deepEqual(f.adapter.calls.map(request => ({ provider: request.provider, model: request.model, sessionId: request.sessionId })), [{ provider: 'offline', model: 'fallback', sessionId: undefined }]);
    assert.equal(bindingCount, 0);
    releaseController.resolve(); stop();
    const attempt = await starting; const result = await attempt.result;
    assert.equal(result.stopReason, 'completed'); assert.deepEqual(result.structured, { findings: [] });
    assert.equal(bindingCount, 1);
    assert.deepEqual(f.adapter.calls.map(request => ({ model: request.model, sessionId: request.sessionId })), [{ model: 'fallback', sessionId: undefined }, { model: 'a', sessionId: attempt.childId }]);
  } finally {
    releaseController.resolve(); stop(); const attempt = await starting.catch(() => undefined); await attempt?.dispose();
  }
});

test('accidental administrative followup and direct controller stream make zero extra model calls', { timeout: 15_000 }, async t => {
  const reviewerEntered = barrier(); const releaseReviewer = barrier(); let reviewerId: string | undefined;
  const f = await fixture(t, async request => {
    if (request.sessionId !== reviewerId) return []; // A broken controller guard fails promptly, never hangs this fixture.
    reviewerEntered.resolve(); const signal = request.signal; assert.ok(signal);
    await new Promise<void>((resolveRelease, reject) => {
      const abort = () => reject(signal.reason ?? new Error('reviewer cancelled'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      void releaseReviewer.promise.then(() => { signal.removeEventListener('abort', abort); resolveRelease(); });
    });
    return empty;
  });
  const snapshot = await prepareEvidence({ kind: 'local', root: f.root });
  const starting = new NativeReviewerDriver(f.ctx).start({ owner: f.parent, attemptId: 'administrative-followup', provider: 'offline', model: 'a', snapshot,
    prompt: 'Only the reviewer may execute.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async ids => { reviewerId = ids.childId; } });
  void starting.catch(() => {});
  try {
    const attempt = await starting; await reviewerEntered.promise;
    const controller = f.ctx.agents.get(SessionId(attempt.controllerId)); assert.ok(controller);
    assert.equal(f.adapter.calls.length, 1); assert.equal(f.adapter.calls[0]?.sessionId, attempt.childId);
    controller.followup(createUserMessage({ content: [{ type: 'text', text: 'Accidental administrative prompt must not call a model.' }], source: { kind: 'user' } }));
    await controller.whenIdle(); assert.equal(f.adapter.calls.length, 1, 'administrative pre-step rejects the waking prompt');
    const deniedChunks: StreamChunk[] = []; let denial: unknown;
    try {
      for await (const chunk of f.ctx.llm.stream({ provider: 'offline', model: 'a', messages: [], sessionId: controller.session.id, signal: new AbortController().signal })) deniedChunks.push(chunk);
    } catch (error) { denial = error; }
    assert.ok(denial instanceof Error ? /Administrative review controller/.test(denial.message) : deniedChunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error'), 'the final native stream boundary denies controller model execution');
    assert.equal(f.adapter.calls.length, 1, 'controller denial happens before the offline adapter');
    releaseReviewer.resolve(); const result = await attempt.result;
    assert.equal(result.stopReason, 'completed'); assert.deepEqual(result.structured, { findings: [] });
    assert.equal(f.adapter.calls.length, 1); assert.equal(f.adapter.calls[0]?.sessionId, attempt.childId);
  } finally {
    releaseReviewer.resolve(); const attempt = await starting.catch(() => undefined); await attempt?.dispose();
  }
});

for (const superseding of ['cancel', 'dispose'] as const) {
  test(`queued timeout is truly discarded after superseding ${superseding}`, { timeout: 15_000 }, async t => {
    const entered = barrier(); const timeoutHeld = barrier(); const releaseTimeout = barrier(); const writeSettled = barrier(); let held = false;
    const f = await fixture(t, request => { entered.resolve(); return waitForAbort(request.signal); }); f.approve();
    f.setUpdateHook(async (id, transform, next) => {
      const candidate = transform(f.nativeStore.get(id)!);
      if (!held && candidate.audit.at(-1)?.action === 'timeout_decision_pending') {
        held = true; timeoutHeld.resolve(); await releaseTimeout.promise;
        try { return await next(); } finally { writeSettled.resolve(); }
      }
      return next();
    });
    try {
      const receipt = await f.drive(await f.preview(settings({ timeoutMs: 750 }))); assert.equal(receipt.ok, true); assert.ok(receipt.runId);
      await entered.promise; await timeoutHeld.promise;
      let expected: RunRecord; let disposing: Promise<void> | undefined;
      if (superseding === 'cancel') {
        const current = await f.service.status(f.parent, receipt.runId);
        expected = await f.service.cancel(f.parent, { runId: receipt.runId, expectedRevision: current.revision });
        assert.equal(expected.state, 'cancelled');
      } else {
        const stopped = until(f.service, record => record.id === receipt.runId && record.state === 'interrupted' && record.audit.at(-1)?.action === 'attempt_stopped');
        disposing = f.service.dispose(); expected = await stopped;
        assert.equal(expected.state, 'interrupted');
      }
      releaseTimeout.resolve(); await writeSettled.promise;
      await (disposing ?? f.service.dispose()); // Public disposal drains the deadline supervisor as well as native children.
      const restored = (await f.reopen()).get(receipt.runId)!;
      assert.equal(restored.state, expected.state); assert.equal(restored.revision, expected.revision);
      assert.deepEqual(restored.audit, expected.audit, 'discarded timeout must add neither a decision nor an audit occurrence');
      assert.equal(restored.audit.some(event => event.action.startsWith('timeout_')), false);
      assert.equal(f.calls().length, 1); assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id), [f.parent.session.id]);
    } finally { releaseTimeout.resolve(); }
  });
}

test('queued quorum failure cannot overwrite acknowledged cancellation or add stale audit', { timeout: 15_000 }, async t => {
  const failureHeld = barrier(); const releaseFailure = barrier(); const writeSettled = barrier(); let held = false;
  const f = await fixture(t, () => { throw new Error('Isolated reviewer failure'); }); f.approve();
  f.setUpdateHook(async (id, transform, next) => {
    const candidate = transform(f.nativeStore.get(id)!);
    if (!held && candidate.audit.at(-1)?.action === 'quorum_failed') {
      held = true; failureHeld.resolve(); await releaseFailure.promise;
      try { return await next(); } finally { writeSettled.resolve(); }
    }
    return next();
  });
  try {
    const receipt = await f.drive(await f.preview()); assert.equal(receipt.ok, true); assert.ok(receipt.runId); await failureHeld.promise;
    const current = await f.service.status(f.parent, receipt.runId);
    const expected = await f.service.cancel(f.parent, { runId: receipt.runId, expectedRevision: current.revision });
    releaseFailure.resolve(); await writeSettled.promise; await f.service.dispose();
    const restored = (await f.reopen()).get(receipt.runId)!;
    assert.equal(restored.state, 'cancelled'); assert.equal(restored.revision, expected.revision); assert.deepEqual(restored.audit, expected.audit);
    assert.equal(restored.audit.some(event => event.action === 'quorum_failed'), false); assert.equal(f.calls().length, 1);
  } finally { releaseFailure.resolve(); }
});
