import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Context, type EffectMeta } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import Storage from '@deepseek-ai/dsh-storage';
import Commands, { CommandId } from '@deepseek-ai/dsh-commands';
import * as Host from '../src/plugins/cross-review/index.js';
import Approval from '@deepseek-ai/dsh-user-approval';
import type { PostToolDecision } from '@deepseek-ai/dsh-tools';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { CrossReviewService, type ReviewPlan, type ServiceOptions } from '../src/service.js';
import { openReviewStore } from '../src/store.js';
import { parseRecord, type RunRecord } from '../src/records.js';
import { canonicalFindingId } from '../src/judge.js';
import type { ReviewConfig } from '../src/protocol.js';

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
type Call = { name: string; args: unknown };
type Script = (options: GenerateOptions, count: number) => readonly Call[] | Promise<readonly Call[]>;
class OfflineAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  private counts = new Map<string, number>();
  constructor(readonly script: Script) { super(); }
  override providerInfo(id: string) { return { id, name: 'Service fixture: no network' }; }
  override async listModels(provider: string) { return ['parent', 'a', 'b', 'c', 'judge'].map(id => ({ provider, id, name: id })); }
  override async resolveModel(provider: string, id: string) { return { provider, id, name: id }; }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options); const count = (this.counts.get(options.model) ?? 0) + 1; this.counts.set(options.model, count);
    const calls = await this.script(options, count);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call' as const, id: ToolCallId(`service-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}
const empty = [{ name: 'structured_output', args: { findings: [] } }];
const finding = { id: 'reviewer-local', title: 'Actionable fixture defect', body: 'A independently verifiable test candidate.', severity: 'high' as const, path: 'main.ts', startLine: 1, endLine: 1, quote: 'export const VALUE = 1;' };
const findingCalls = [{ name: 'structured_output', args: { findings: [finding] } }];
const config = (overrides: Partial<ReviewConfig> = {}): ReviewConfig => ({ reviewers: ['a', 'b', 'c'].map(id => ({ id, provider: 'offline', model: id, focus: 'correctness' })), concurrency: 2, timeoutMs: 10_000, judge: { kind: 'parent' }, ...overrides });
function until(service: CrossReviewService, predicate: (record: RunRecord) => boolean): Promise<RunRecord> {
  const done = deferred<RunRecord>(); const stop = service.subscribe(record => { if (predicate(record)) { stop(); done.resolve(record); } }); return done.promise;
}
async function blocked(signal: AbortSignal | undefined, entered?: ReturnType<typeof deferred<void>>, stopped?: ReturnType<typeof deferred<void>>): Promise<readonly Call[]> {
  assert.ok(signal); entered?.resolve();
  await new Promise<void>((_resolve, reject) => {
    const abort = () => { stopped?.resolve(); reject(signal.reason ?? new Error('stopped')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  }); return [];
}
function creationListeners(ctx: Context): number {
  const count = (effects: readonly EffectMeta[]): number => effects.reduce((sum, effect) => sum + Number(effect.label.includes('agent/created')) + count(effect.children), 0);
  return count(ctx.fiber.getEffects());
}
async function fixture(t: TestContext, script: Script = () => empty, approval: 'ask' | 'never' | 'absent' = 'ask', options: ServiceOptions = {}) {
  const temp = await realpath(tmpdir()); const scratch = await realpath(await mkdtemp(join(temp, 'dsh-service-test-')));
  const root = join(scratch, 'repo'); await mkdir(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, env, stdio: 'pipe' });
  git('init', '-q'); await writeFile(join(root, 'main.ts'), 'export const VALUE = 1;\n'); git('add', 'main.ts'); git('commit', '-qm', 'fixture');
  const ctx = new Context(); let service: CrossReviewService | undefined;
  let openedStore: Awaited<ReturnType<typeof openReviewStore>> | undefined;
  t.after(async () => {
    if (service) await service.dispose(); else await openedStore?.close();
    await ctx.fiber.dispose();
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), temp); assert.ok(basename(scratch).startsWith('dsh-service-test-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  await mountAgentLoopTestDependencies(ctx); await ctx.plugin(Storage);
  if (approval !== 'absent') await ctx.plugin(Approval, { policy: approval });
  let parentPlan: Pick<ReviewPlan, 'id'> | undefined;
  const adapter = new OfflineAdapter((request, count) => request.model === 'parent' ? (parentPlan && count % 2 === 1 ? [{ name: 'cross_review_start', args: { planId: parentPlan.id } }] : []) : script(request, count));
  ctx.llm.registerAdapter(['offline'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SubagentRuntime, { maxDepth: 2, maxActiveSubagents: 8 }); await ctx.plugin(Spawn, { providerName: 'spawn' });
  const parent = await harness.create(SessionId('service-parent'), { provider: 'offline', model: 'parent' }, { cwd: root });
  const storeRoot = join(scratch, 'store'); const store = await openReviewStore(ctx, storeRoot); openedStore = store;
  service = new CrossReviewService(ctx, store, { configurationHome: scratch, ...options }); const current = service;
  async function preview(settings: ReviewConfig = config()) { return current.preview(parent, { kind: 'local', root }, [{ source: 'test', value: settings }]); }
  async function start(plan: ReviewPlan): Promise<RunRecord> {
    parentPlan = plan;
    const done = deferred<RunRecord>();
    const stop = ctx.on('tools/result', (exec, result) => {
      if (exec.agent !== parent || exec.name !== 'cross_review_start') return undefined;
      stop();
      if (result.isError) done.reject(new Error(result.error.message));
      else { const id = (result.value as { runId: string }).runId; const record = store.get(id); if (record) done.resolve(record); else done.reject(new Error('receipt missing run')); }
      return undefined;
    });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the frozen preview.' }], source: { kind: 'user' } }));
    try { return await done.promise; } finally { stop(); await parent.whenIdle(); }
  }
  function approve() { return parent.ctx.on('approval/request', async request => { assert.equal(request.agent, parent); assert.equal(request.toolName, 'cross_review_start'); assert.match(request.reason ?? '', /Cross-review plan [a-f0-9]{64}/); return 'allowed-once'; }); }
  const reviewerCalls = () => adapter.calls.filter(call => call.model !== 'parent');
  return { ctx, service: current, store, storeRoot, root, parent, harness, adapter, preview, start, approve, reviewerCalls,
    setParentPlan(id: string) { parentPlan = { id }; } };
}

test('actual Host mounts without TUI and registers native tools and human commands', { timeout: 20_000 }, async t => {
  const f = await fixture(t); await f.service.dispose(); await f.ctx.plugin(Commands);
  const previousHome = process.env.HOME;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  process.env.HOME = dirname(f.root); // Host policy is unchanged; isolate its lazy homedir() reads through preview.
  const host = await f.ctx.plugin(Host, { root: f.storeRoot, review: config(), preauthorizedDigests: [] });
  const backend = f.ctx.crossReview; assert.ok(backend); assert.ok(f.ctx.commands.find(f.parent, 'review'));
  const names = ['cross_review_preview', 'cross_review_start', 'cross_review_status', 'cross_review_report', 'cross_review_evidence', 'cross_review_control', 'cross_review_judge'];
  for (const name of names) assert.ok(f.ctx.tools.get(name, f.parent));
  const invoke = async (name: string, args: unknown) => {
    const result = await f.ctx.tools.execute({ agent: f.parent, name, arguments: args, callId: ToolCallId(`host-${randomUUID()}`), signal: new AbortController().signal });
    assert.equal(result.isError, false, result.isError ? result.error.message : '');
    assert.equal(typeof result.value, 'string'); return JSON.parse(result.value as string) as any;
  };
  const preview = await invoke('cross_review_preview', { request: {} }); assert.equal(f.adapter.calls.length, 0);
  f.approve(); f.setParentPlan(preview.planId);
  const receipt = deferred<string>();
  const remove = f.ctx.on('tools/result', (exec, result) => {
    if (exec.agent !== f.parent || exec.name !== 'cross_review_start') return undefined;
    remove(); if (result.isError) receipt.reject(new Error(result.error.message)); else receipt.resolve((result.value as { runId: string }).runId); return undefined;
  });
  const completed = until(backend, r => r.state === 'completed');
  f.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start native Host review.' }], source: { kind: 'user' } }));
  const runId = await receipt.promise; await f.parent.whenIdle(); const record = await completed; assert.equal(record.id, runId);
  const report = await invoke('cross_review_report', { runId }); assert.equal(report.complete, true);
  const status = await invoke('cross_review_status', { runId }); assert.equal(status.snapshot.files, undefined);
  const evidence = await invoke('cross_review_evidence', { runId, kind: 'file', path: 'main.ts', offset: 1, limit: 1 }); assert.equal(evidence.lines[0].text, finding.quote);
  const command = await f.ctx.commands.execute(f.parent, `/review report ${runId}`, [], new AbortController().signal); assert.equal(command?.result.kind, 'success');
  await invoke('cross_review_control', { runId, expectedRevision: record.revision, action: 'cleanup' });
  await host.dispose();
  for (const name of names) assert.equal(f.ctx.tools.get(name, f.parent), undefined);
  assert.equal(f.ctx.commands.find(f.parent, 'review'), undefined); assert.equal(f.ctx.get('crossReview', false), undefined);
});

test('new review previews load global then worktree-local files before Host and invocation overlays', { timeout: 20_000 }, async t => {
  const f = await fixture(t, () => assert.fail('configuration must not start reviewers'), 'ask', { configLayers: [{ source: 'host-plugin', value: { concurrency: 4 } }] });
  const home = dirname(f.root);
  await mkdir(join(home, '.dsh')); await mkdir(join(f.root, '.dsh'));
  await writeFile(join(home, '.dsh', 'cross-review.json'), JSON.stringify(config({ concurrency: 1, timeoutMs: 15_000 })));
  await writeFile(join(f.root, '.dsh', 'cross-review.json'), JSON.stringify({ concurrency: 3, timeoutMs: 20_000 }));
  await assert.rejects(f.service.preview(f.parent, { kind: 'local', root: f.root }), /restricted evidence path/, 'Setup does not weaken the existing runtime evidence exclusion');
  // Explicit fixture project policy, not a setup side effect or evidence bypass.
  await appendFile(join(f.root, '.git', 'info', 'exclude'), '\n.dsh/cross-review.json\n');
  const first = await f.service.preview(f.parent, { kind: 'local', root: f.root });
  assert.equal(first.config.concurrency, 4); assert.equal(first.config.timeoutMs, 20_000);
  assert.equal(first.sources.concurrency, 'host-plugin'); assert.match(first.sources.timeoutMs!, /^local:/);
  assert.match(first.sources.reviewers!, /^global:/);
  const overridden = await f.service.preview(f.parent, { kind: 'local', root: f.root }, [{ source: 'invocation', value: { concurrency: 5, reviewers: config().reviewers.slice(0, 1) } }]);
  assert.equal(overridden.config.concurrency, 5); assert.equal(overridden.config.reviewers.length, 1);
  assert.equal(overridden.sources.reviewers, 'invocation');
  await writeFile(join(f.root, '.dsh', 'cross-review.json'), JSON.stringify({ timeoutMs: 25_000 }));
  const next = await f.service.preview(f.parent, { kind: 'local', root: f.root });
  assert.equal(next.config.timeoutMs, 25_000); assert.equal(first.config.timeoutMs, 20_000, 'Already frozen previews stay unchanged');
  await writeFile(join(f.root, '.dsh', 'cross-review.json'), '{');
  await assert.rejects(f.service.preview(f.parent, { kind: 'local', root: f.root }), /JSON|position|property/i);
  assert.equal(f.adapter.calls.length, 0); assert.deepEqual(f.store.list(), []);
});

test('review preview accepts a symlink configurationHome with absent and global file layers', { timeout: 20_000 }, async t => {
  const f = await fixture(t, () => assert.fail('configuration must not start reviewers')); await f.service.dispose();
  const home = dirname(f.root); const alias = join(home, 'home-alias'); await symlink(home, alias, 'dir');
  async function preview(configLayers: ServiceOptions['configLayers']) {
    const service = new CrossReviewService(f.ctx, await openReviewStore(f.ctx, f.storeRoot), { configurationHome: alias, configLayers });
    try { return await service.preview(f.parent, { kind: 'local', root: f.root }); } finally { await service.dispose(); }
  }
  const absent = await preview([{ source: 'host-plugin', value: config() }]);
  assert.deepEqual(absent.config, config()); assert.equal(absent.sources.reviewers, 'host-plugin');
  await mkdir(join(home, '.dsh'));
  const global = config({ concurrency: 1, timeoutMs: 15_000 });
  await writeFile(join(home, '.dsh', 'cross-review.json'), JSON.stringify(global));
  const layered = await preview([]);
  assert.deepEqual(layered.config, global); assert.equal(layered.sources.reviewers, `global:${join(home, '.dsh', 'cross-review.json')}`);
  assert.equal(layered.sources.concurrency, layered.sources.reviewers); assert.equal(f.adapter.calls.length, 0);
});

test('plain DSH no-TUI review completes from events without status-driven scheduling', { timeout: 20_000 }, async t => {
  const f = await fixture(t); f.approve(); const baseline = creationListeners(f.ctx);
  const completed = until(f.service, r => r.state === 'completed'); const plan = await f.preview(); const started = await f.start(plan);
  const record = await completed;
  assert.equal(record.id, started.id); assert.equal(record.attempts.filter(a => a.state === 'completed').length, 3);
  assert.equal(f.reviewerCalls().length, 3); assert.ok(record.attempts.every(a => a.childId && a.controllerId && a.snapshotId === plan.snapshot.id));
  const before = JSON.stringify(f.store.get(record.id)); const calls = f.adapter.calls.length;
  const report = await f.service.report(f.parent, record.id); await f.service.status(f.parent, record.id); await f.service.list(f.parent);
  assert.equal(report.complete, true); assert.deepEqual(report.findings, []); assert.equal(JSON.stringify(f.store.get(record.id)), before); assert.equal(f.adapter.calls.length, calls);
  assert.deepEqual(f.ctx.agents.list().map(a => a.session.id), [f.parent.session.id]); assert.equal(creationListeners(f.ctx), baseline);
});

for (const mode of ['guard', 'never', 'unavailable', 'absent', 'wrong-digest'] as const) {
  test(`startup ${mode} creates no reviewer or paid attempt`, { timeout: 20_000 }, async t => {
    const digests: string[] = []; const f = await fixture(t, () => assert.fail('unauthorized reviewer'), mode === 'never' ? 'never' : mode === 'absent' ? 'absent' : 'ask', { preauthorizedDigests: digests });
    const plan = await f.preview(); let answerers = 0;
    if (mode === 'never') { digests.push(plan.digest); f.parent.ctx.on('approval/request', async () => { answerers++; return 'allowed-once'; }); }
    if (mode === 'guard') { f.approve(); f.parent.ctx.tools.guard(exec => exec.name === 'cross_review_start' ? 'Host denial' : undefined); }
    if (mode === 'wrong-digest') digests.push('0'.repeat(64));
    await assert.rejects(f.start(plan), /denial|rejected|unavailable/i);
    assert.equal(answerers, 0); assert.equal(f.reviewerCalls().length, 0); assert.equal(f.store.list().length, 0);
    assert.deepEqual(f.ctx.agents.list().map(a => a.session.id), [f.parent.session.id]);
  });
}

for (const mode of ['block', 'invalid-receipt', 'replacement-receipt'] as const) {
  test(`authoritative startup post-execute ${mode} cannot launch reviewers`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, () => assert.fail('model after rejected startup')); f.approve();
    f.parent.ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
      if (exec.name !== 'cross_review_start' || result.isError) return next();
      if (mode === 'block') return { kind: 'block', feedback: [{ type: 'text', text: 'Host final policy denial' }] };
      if (mode === 'invalid-receipt') return { kind: 'accept', value: { unexpected: true } };
      return { kind: 'accept', value: { runId: randomUUID(), revision: 0, state: 'running' } };
    });
    await assert.rejects(f.start(await f.preview()), /policy|output|schema|receipt|missing/i);
    assert.equal(f.reviewerCalls().length, 0);
    assert.deepEqual(f.ctx.agents.list().map(a => a.session.id), [f.parent.session.id]);
  });
}

for (const outcome of ['rejected', 'unavailable'] as const) {
  test(`correct headless digest never bypasses native ${outcome}`, { timeout: 20_000 }, async t => {
    const digests: string[] = [];
    const f = await fixture(t, () => assert.fail('review after denied native headless authorization'), 'ask', { preauthorizedDigests: digests });
    const plan = await f.preview(); digests.push(plan.digest);
    let nativeQuestions = 0;
    f.parent.ctx.on('approval/request', async request => {
      nativeQuestions++;
      assert.equal(request.agent, f.parent); assert.equal(request.toolName, 'cross_review_start');
      assert.ok(request.reason?.includes(plan.digest));
      return outcome;
    });
    await assert.rejects(f.start(plan), new RegExp(outcome));
    assert.equal(nativeQuestions, 1, 'existing native authorizer must not be preempted');
    assert.equal(f.reviewerCalls().length, 0); assert.deepEqual(f.store.list(), []);
    assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id), [f.parent.session.id]);
  });
}

test('headless preauthorization matches exact plan and remains single-use', { timeout: 20_000 }, async t => {
  const digests: string[] = []; const f = await fixture(t, () => empty, 'ask', { preauthorizedDigests: digests });
  f.approve(); // Explicit fixture machine authorizer; the application digest grants no native permission.
  const plan = await f.preview(); digests.push(plan.digest);
  const completed = until(f.service, r => r.state === 'completed'); const run = await f.start(plan); await completed;
  assert.equal(f.store.get(run.id)?.authorization.mode, 'headless');
  await assert.rejects(f.service.start(f.parent, plan.id, new AbortController().signal), /Unknown.*review plan/);
  assert.equal(f.reviewerCalls().length, 3);
});

test('cancelled native approval cannot admit reviewers', { timeout: 20_000 }, async t => {
  const entered = deferred(); const f = await fixture(t, () => assert.fail('review after cancelled authorization'));
  f.parent.ctx.on('approval/request', async (request) => { entered.resolve(); await blocked(request.signal); return 'allowed-once'; });
  const plan = await f.preview(); const starting = f.start(plan); const rejected = assert.rejects(starting, /cancel|abort/i);
  await entered.promise; f.parent.cancel({ kind: 'user' }); await rejected;
  assert.equal(f.reviewerCalls().length, 0); assert.equal(f.store.list().length, 0);
});

test('concurrency is bounded and one isolated reviewer failure still permits strict majority quorum', { timeout: 20_000 }, async t => {
  const enteredA = deferred(); const enteredB = deferred(); const enteredC = deferred(); const releaseA = deferred(); const releaseB = deferred(); const releaseC = deferred();
  const f = await fixture(t, async options => {
    if (options.model === 'a') { enteredA.resolve(); await releaseA.promise; return empty; }
    if (options.model === 'b') { enteredB.resolve(); await releaseB.promise; throw new Error('isolated reviewer failure'); }
    enteredC.resolve(); await releaseC.promise; return empty;
  }); f.approve(); const completed = until(f.service, r => r.state === 'completed'); const starting = f.start(await f.preview());
  await Promise.all([enteredA.promise, enteredB.promise]); assert.equal(f.reviewerCalls().length, 2);
  releaseA.resolve(); await enteredC.promise; assert.equal(f.reviewerCalls().length, 3);
  releaseB.resolve(); releaseC.resolve(); await starting; const record = await completed;
  assert.equal(record.attempts.filter(a => a.state === 'completed').length, 2); assert.equal(record.attempts.filter(a => a.state === 'failed').length, 1);
});

test('missing terminal schema-valid majority fails without automatic replacement', { timeout: 20_000 }, async t => {
  const f = await fixture(t, options => { if (options.model !== 'c') throw new Error('reviewer failed'); return empty; }); f.approve();
  const failed = until(f.service, r => r.state === 'failed'); await f.start(await f.preview()); const record = await failed;
  assert.equal(record.attempts.filter(a => a.state === 'completed').length, 1); assert.equal(f.reviewerCalls().length, 3); assert.match(record.failure ?? '', /Insufficient/);
});

for (const successful of [1, 2]) {
  test(`timeout stops real work, awaits decision, and preserves ${successful === 2 ? 'quorum' : 'insufficient results'}`, { timeout: 20_000 }, async t => {
    let stopped = 0; const f = await fixture(t, async options => {
      if (['a', ...(successful === 2 ? ['b'] : [])].includes(options.model)) return empty;
      try { return await blocked(options.signal); } finally { stopped++; }
    }); f.approve();
    const quiescent = until(f.service, r => r.audit.at(-1)?.action === 'timeout_work_stopped');
    const run = await f.start(await f.preview(config({ concurrency: 3, timeoutMs: 1000 }))); const timedOut = await quiescent;
    assert.equal(timedOut.state, 'awaiting_timeout'); assert.equal(stopped, 3 - successful);
    assert.equal((await f.service.report(f.parent, run.id)).complete, false); assert.equal(f.reviewerCalls().length, 3);
    const preserved = await f.service.decideTimeout(f.parent, { runId: run.id, expectedRevision: timedOut.revision }, 'preserve');
    assert.equal(preserved.state, successful === 2 ? 'completed' : 'failed'); assert.equal(f.reviewerCalls().length, 3);
  });
}

test('parent judgment is pending despite unanimous findings; stale and unowned controls reject atomically', { timeout: 20_000 }, async t => {
  const f = await fixture(t, () => findingCalls); f.approve(); const pending = until(f.service, r => r.state === 'awaiting_judge'); await f.start(await f.preview()); const record = await pending;
  const report = await f.service.report(f.parent, record.id); assert.equal(report.complete, false); assert.equal(report.findings.length, 0); assert.equal(report.pending.length, 1);
  const other = await f.harness.create(SessionId('other-parent'), { provider: 'offline', model: 'parent' }, { cwd: f.root });
  await assert.rejects(f.service.status(other, record.id), /ownership/);
  const verdict = [{ findingId: report.pending[0]!.id, verdict: 'verified' as const, reason: 'Independent source verification', severity: 'medium' as const }];
  await assert.rejects(f.service.judge(f.parent, { runId: record.id, expectedRevision: record.revision - 1 }, verdict), /Stale/);
  const outcomes = await Promise.allSettled([
    f.service.judge(f.parent, { runId: record.id, expectedRevision: record.revision }, verdict),
    f.service.cancel(f.parent, { runId: record.id, expectedRevision: record.revision }),
  ]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  const final = f.store.get(record.id)!; assert.equal(final.revision, record.revision + 1);
  assert.ok(['completed', 'cancelled'].includes(final.state));
});

test('explicit model judge uses exact requested route and no fallback', { timeout: 20_000 }, async t => {
  const f = await fixture(t, options => options.model === 'judge' ? [{ name: 'structured_output', args: { decisions: [{ findingId: canonicalFindingId(finding), verdict: 'verified', reason: 'Independently inspected immutable source', severity: 'low' }] } }] : findingCalls); f.approve();
  const completed = until(f.service, r => r.state === 'completed'); const plan = await f.preview(config({ judge: { kind: 'model', provider: 'offline', model: 'judge' } }));
  await f.start(plan); const record = await completed; assert.equal(record.attempts.filter(a => a.kind === 'judge').length, 1);
  assert.equal(f.reviewerCalls().filter(c => c.model === 'judge' && c.provider === 'offline').length, 1);
  const report = await f.service.report(f.parent, record.id); assert.equal(report.findings[0]?.severity, 'low');
  await assert.rejects(f.preview(config({ judge: { kind: 'model', provider: 'offline', model: 'missing-model' } })), /Unavailable exact model/);
});

test('cancel and disposal drain native children, timers, lifecycle listeners, and start capability', { timeout: 20_000 }, async t => {
  const entered = deferred(); const stopped = deferred(); const f = await fixture(t, options => blocked(options.signal, entered, stopped)); f.approve();
  const baseline = creationListeners(f.ctx); const run = await f.start(await f.preview(config({ concurrency: 1 }))); await entered.promise;
  const bound = f.store.get(run.id)!; const cancelled = await f.service.cancel(f.parent, { runId: run.id, expectedRevision: bound.revision });
  await stopped.promise; assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.cancellationIntent, true);
  assert.equal(cancelled.attempts.filter(a => a.state === 'completed').length, 0); assert.deepEqual(f.ctx.agents.list().map(a => a.session.id), [f.parent.session.id]);
  let changes = 0; const stop = f.service.subscribe(() => { changes++; }); stop();
  await Promise.all([f.service.dispose(), f.service.dispose()]);
  assert.equal(changes, 0); assert.equal(creationListeners(f.ctx), baseline); assert.equal(f.ctx.tools.get('cross_review_start', f.parent), undefined);
  assert.throws(() => f.service.subscribe(() => {}), /closing/); await assert.rejects(f.service.status(f.parent, run.id), /closing/);
});

test('disposal interrupts an active native model request and never starts pending reviewers', { timeout: 20_000 }, async t => {
  const entered = deferred(); const stopped = deferred(); const f = await fixture(t, options => blocked(options.signal, entered, stopped)); f.approve();
  const baseline = creationListeners(f.ctx); const seen: RunRecord[] = []; f.service.subscribe(record => seen.push(record));
  await f.start(await f.preview(config({ concurrency: 1 }))); await entered.promise;
  await f.service.dispose(); await stopped.promise;
  assert.equal(f.reviewerCalls().length, 1); assert.ok(seen.some(record => record.state === 'interrupted'));
  assert.equal(seen.some(record => record.state === 'completed'), false);
  assert.deepEqual(f.ctx.agents.list().map(a => a.session.id), [f.parent.session.id]); assert.equal(creationListeners(f.ctx), baseline);
  assert.equal(f.ctx.tools.get('cross_review_start', f.parent), undefined);
});

test('explicit timeout abort leaves a cancelled incomplete run without replay', { timeout: 20_000 }, async t => {
  const f = await fixture(t, options => blocked(options.signal)); f.approve();
  const stopped = until(f.service, r => r.audit.at(-1)?.action === 'timeout_work_stopped');
  const run = await f.start(await f.preview(config({ concurrency: 1, timeoutMs: 500 }))); const timed = await stopped;
  const final = await f.service.decideTimeout(f.parent, { runId: run.id, expectedRevision: timed.revision }, 'abort');
  assert.equal(final.state, 'cancelled'); assert.equal(final.cancellationIntent, true); assert.equal((await f.service.report(f.parent, run.id)).complete, false);
  assert.equal(f.reviewerCalls().length, 1);
});

test('reopening native durable storage reuses terminal results and interrupts unknown work with zero model replay', { timeout: 20_000 }, async t => {
  const f = await fixture(t); f.approve(); const completed = until(f.service, r => r.state === 'completed'); await f.start(await f.preview()); const previous = await completed;
  const unknown = structuredClone(previous); unknown.id = randomUUID(); unknown.state = 'running'; unknown.revision = 0;
  for (const attempt of unknown.attempts) { attempt.id = randomUUID(); attempt.state = 'pending'; delete attempt.result; delete attempt.childId; delete attempt.controllerId; delete attempt.snapshotId; }
  await f.store.put(parseRecord(unknown)); const count = f.adapter.calls.length; await f.service.dispose();
  const store = await openReviewStore(f.ctx, f.storeRoot); const recovered = new CrossReviewService(f.ctx, store); t.after(() => recovered.dispose());
  await recovered.recover(); const completedAgain = await recovered.status(f.parent, previous.id); const interrupted = await recovered.status(f.parent, unknown.id);
  assert.equal(completedAgain.state, 'completed'); assert.deepEqual(completedAgain.attempts.map(a => a.result), previous.attempts.map(a => a.result));
  assert.equal(interrupted.state, 'interrupted'); assert.ok(interrupted.attempts.every(a => a.state === 'interrupted'));
  assert.equal(f.adapter.calls.length, count); assert.equal((await recovered.report(f.parent, previous.id)).complete, true);
  await recovered.dispose();
});

test('renamed workspace cannot block status, evidence, cancellation or terminal recovery', { timeout: 20_000 }, async t => {
  const entered = deferred(); const stopped = deferred(); const f = await fixture(t, request => blocked(request.signal, entered, stopped)); f.approve();
  const plan = await f.preview(config({ concurrency: 1 })); const run = await f.start(plan); await entered.promise;
  const source = resolve(f.root); const target = resolve(dirname(f.root), 'renamed-repo');
  // Verify both exact absolute move endpoints and refuse an existing target.
  assert.equal(source, f.root); assert.equal(await realpath(source), source);
  assert.equal(dirname(target), dirname(source)); assert.equal(basename(target), 'renamed-repo'); assert.notEqual(source, target);
  await assert.rejects(lstat(target), { code: 'ENOENT' });
  await rename(source, target); await assert.rejects(lstat(source), { code: 'ENOENT' });
  const status = await f.service.status(f.parent, run.id);
  assert.equal(status.owner.workspaceCwd, f.parent.session.header.cwd); assert.equal(status.snapshot.id, plan.snapshot.id);
  assert.deepEqual((await f.service.list(f.parent)).map(record => record.id), [run.id]);
  assert.equal((await f.service.report(f.parent, run.id)).complete, false);
  const attempt = status.attempts.find(item => item.state === 'running'); assert.ok(attempt?.childId);
  const child = f.ctx.agents.get(SessionId(attempt.childId)); assert.ok(child);
  const evidence = await f.ctx.tools.execute({ agent: child, name: 'evidence_read', arguments: { path: 'main.ts', offset: 1, limit: 1 }, callId: ToolCallId(`renamed-workspace-${randomUUID()}`), signal: new AbortController().signal });
  assert.equal(evidence.isError, false, evidence.isError ? evidence.error.message : '');
  assert.equal(JSON.parse(evidence.value as string).lines[0].text, finding.quote, 'native evidence reads remain bound to immutable memory');
  const cancelled = await f.service.cancel(f.parent, { runId: run.id, expectedRevision: status.revision }); await stopped.promise;
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.cancellationIntent, true); assert.equal(f.reviewerCalls().length, 1);
  assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id), [f.parent.session.id]);
  await f.service.dispose();
  const store = await openReviewStore(f.ctx, f.storeRoot); const recovered = new CrossReviewService(f.ctx, store);
  try {
    await recovered.recover(); const report = await recovered.report(f.parent, run.id);
    assert.equal(report.state, 'cancelled'); assert.equal(report.complete, false); assert.equal(report.snapshotId, plan.snapshot.id);
    assert.deepEqual((await recovered.list(f.parent)).map(record => record.id), [run.id]);
    assert.equal((await recovered.status(f.parent, run.id)).owner.workspaceCwd, status.owner.workspaceCwd);
    assert.equal(f.reviewerCalls().length, 1, 'workspace disappearance and recovery never replay models');
  } finally { await recovered.dispose(); }
});

test('human preview command preserves repeated spaces and JSON newline escapes in notes and focus', { timeout: 20_000 }, async t => {
  const f = await fixture(t); let captured: Parameters<CrossReviewService['preview']> | undefined;
  const previewBoundary = { preview: async (...args: Parameters<CrossReviewService['preview']>) => { captured = args; return f.service.preview(...args); } };
  const command = Host.createReviewCommand(previewBoundary as unknown as CrossReviewService);
  const request = { target: { kind: 'local', root: f.root }, configuration: { reviewers: [{ id: 'a', provider: 'offline', model: 'a', focus: 'one  two' }] }, notes: ['one  two', 'line one\nline  two'] };
  const result = await command.handler({ commandId: CommandId('preserve-preview-json'), agent: f.parent, rawInput: `preview   ${JSON.stringify(request, null, 2)}`, attachments: [], signal: new AbortController().signal });
  assert.equal(result.kind, 'success', result.text); assert.ok(captured);
  assert.equal(captured[0], f.parent); assert.deepEqual(captured[1], request.target);
  assert.deepEqual(captured[2], [{ source: 'invocation', value: request.configuration }]);
  assert.deepEqual(captured[3]?.notes, request.notes);
  assert.equal(JSON.parse(result.text!).config.reviewers[0].focus, 'one  two');
  assert.equal(f.adapter.calls.length, 0, 'mocking the preview boundary does not fake native admission'); assert.deepEqual(f.store.list(), []);
});
