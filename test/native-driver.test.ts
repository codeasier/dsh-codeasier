import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Context, type EffectMeta } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { prepareEvidence, validateSnapshot, type Snapshot } from '../src/evidence.js';
import { NativeReviewerDriver, type NativeAttemptInput } from '../src/native-driver.js';
import { JUDGE_SCHEMA, REVIEWER_SCHEMA } from '../src/protocol.js';

type Call = { name: string; args: unknown };
type Script = (options: GenerateOptions, count: number) => readonly Call[] | Promise<readonly Call[]>;
function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => { resolvePromise = resolveValue; rejectPromise = rejectValue; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/** Only local scripted streams are mounted: no credentials, providers, or network. */
class ScriptedAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  private readonly counts = new Map<string, number>();
  constructor(private readonly script: Script) { super(); }
  override providerInfo(id: string) { return { id, name: 'Native driver fixture (no network)' }; }
  override async resolveModel(provider: string, id: string) { return { provider, id, name: id }; }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options);
    const count = (this.counts.get(options.model) ?? 0) + 1;
    this.counts.set(options.model, count);
    const calls = await this.script(options, count);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call' as const, id: ToolCallId(`fixture-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}

async function evidenceFixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temporaryRoot, 'dsh-native-driver-')));
  t.after(async () => {
    // Verify the exact resolved fixture target before recursive deletion.
    assert.equal(resolve(root), root);
    assert.equal(dirname(root), temporaryRoot);
    assert.ok(basename(root).startsWith('dsh-native-driver-'));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith('GIT_')) delete environment[name];
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd: root, stdio: 'pipe', timeout: 10_000,
    env: { ...environment, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  });
  git('init', '-q');
  await writeFile(join(root, 'main.ts'), 'const ORIGINAL_EVIDENCE = true;\n');
  git('add', '--', 'main.ts');
  git('commit', '-qm', 'isolated evidence fixture');
  const snapshot = await prepareEvidence({ kind: 'local', root });
  assert.equal(validateSnapshot(snapshot).id, snapshot.id);
  return { root, snapshot };
}

async function fixture(t: TestContext, script: Script) {
  const evidence = await evidenceFixture(t);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await mountAgentLoopTestDependencies(ctx);
  const adapter = new ScriptedAdapter(script);
  ctx.llm.registerAdapter(['fixture'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  // One administration controller adds lineage but never a paid/model request.
  await ctx.plugin(SubagentRuntime, { maxDepth: 2, maxActiveSubagents: 8 });
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  const parent = await harness.create(SessionId('driver-parent'), { provider: 'fixture', model: 'parent-model' }, { cwd: evidence.root });
  const driver = new NativeReviewerDriver(ctx);
  function request(overrides: Partial<Omit<NativeAttemptInput, 'owner'>> = {}): NativeAttemptInput {
    return { owner: parent, attemptId: 'reviewer-attempt', provider: 'fixture', model: 'reviewer-model', snapshot: evidence.snapshot,
      prompt: 'Review bound immutable evidence only.', schema: REVIEWER_SCHEMA, signal: new AbortController().signal, bind: async () => {}, ...overrides };
  }
  return { ...evidence, ctx, adapter, parent, driver, request };
}

function createdListenerCount(ctx: Context): number {
  const count = (effects: readonly EffectMeta[]): number => effects.reduce((total, effect) => total + (effect.label.includes('agent/created') ? 1 : 0) + count(effect.children), 0);
  return count(ctx.fiber.getEffects());
}
function assertClean(ctx: Context, parentId: string, baseline: number, signal?: AbortSignal, signalBaseline = 0) {
  assert.deepEqual(ctx.agents.list().map(agent => agent.session.id), [parentId], 'controllers and children must be removed');
  assert.equal(createdListenerCount(ctx), baseline, 'driver lifecycle listener must be removed');
  if (signal) assert.equal(getEventListeners(signal, 'abort').length, signalBaseline, 'driver abort listener must be removed');
}
const expectedTools = ['evidence_diff', 'evidence_list', 'evidence_notes', 'evidence_read', 'structured_output'];

// All synchronization uses explicit lifecycle barriers, never polling or sleeps.
test('concurrent attempts persist exact separate identities before any model call and keep schemas separate', { timeout: 15_000 }, async t => {
  const enteredA = deferred(); const enteredB = deferred(); const releaseA = deferred(); const releaseB = deferred();
  const bindings = new Map<string, { controllerId: string; childId: string; snapshotId: string }>();
  const persisted = new Set<string>();
  const f = await fixture(t, options => {
    assert.ok(options.sessionId);
    assert.ok(persisted.has(options.sessionId), 'model request must await its durable evidence binding');
    const schema = options.model === 'reviewer-a' ? REVIEWER_SCHEMA : JUDGE_SCHEMA;
    assert.deepEqual(options.tools?.map(tool => tool.name).sort(), expectedTools);
    assert.deepEqual(options.tools?.find(tool => tool.name === 'structured_output')?.parameters, schema);
    return [{ name: 'structured_output', args: options.model === 'reviewer-a' ? { findings: [] } : { decisions: [] } }];
  });
  const snapshotB = await prepareEvidence({ kind: 'local', root: f.root }, { notes: ['Second immutable attempt'], pack: { 'extra.ts': 'const EXTRA = 2;\n' } });
  const baseline = createdListenerCount(f.ctx);
  const startA = f.driver.start(f.request({ attemptId: 'a', model: 'reviewer-a', bind: async ids => { bindings.set('a', ids); enteredA.resolve(); await releaseA.promise; persisted.add(ids.childId); } }));
  const startB = f.driver.start(f.request({ attemptId: 'b', model: 'reviewer-b', snapshot: snapshotB, schema: JUDGE_SCHEMA, bind: async ids => { bindings.set('b', ids); enteredB.resolve(); await releaseB.promise; persisted.add(ids.childId); } }));
  await Promise.all([enteredA.promise, enteredB.promise]);
  const a = bindings.get('a')!; const b = bindings.get('b')!;
  assert.notEqual(a.childId, b.childId); assert.notEqual(a.controllerId, b.controllerId);
  assert.notEqual(a.snapshotId, b.snapshotId);
  assert.equal(a.snapshotId, f.snapshot.id); assert.equal(b.snapshotId, snapshotB.id);
  assert.equal(f.adapter.calls.length, 0, 'no model before persistence resolves');
  assert.equal(f.ctx.agents.list().length, 5);
  assert.ok(f.ctx.agents.isOwnedBy(SessionId(a.childId), f.ctx.agents.get(SessionId(a.controllerId))!));
  assert.ok(f.ctx.agents.isOwnedBy(SessionId(b.childId), f.ctx.agents.get(SessionId(b.controllerId))!));
  releaseA.resolve();
  const attemptA = await startA; t.after(() => attemptA.dispose());
  assert.deepEqual((await attemptA.result).structured, { findings: [] });
  assert.equal(f.adapter.calls.some(call => call.model === 'reviewer-b'), false);
  releaseB.resolve();
  const attemptB = await startB; t.after(() => attemptB.dispose());
  const resultB = await attemptB.result;
  assert.equal(resultB.stopReason, 'completed'); assert.deepEqual(resultB.structured, { decisions: [] });
  await Promise.all([attemptA.dispose(), attemptB.dispose()]);
  assertClean(f.ctx, f.parent.session.id, baseline);
});

test('evidence tools read detached snapshot bytes after caller and workspace mutation', { timeout: 15_000 }, async t => {
  const entered = deferred(); const release = deferred();
  const f = await fixture(t, (options, count) => {
    if (count === 1) return [{ name: 'evidence_read', args: { path: 'main.ts', offset: 1, limit: 1 } }];
    const messages = JSON.stringify(options.messages);
    assert.ok(messages.includes('ORIGINAL_EVIDENCE'));
    assert.equal(messages.includes('MUTATED_WORKSPACE'), false);
    assert.equal(messages.includes('MUTATED_INPUT'), false);
    return [{ name: 'structured_output', args: { findings: [] } }];
  });
  const mutable = structuredClone(f.snapshot) as Snapshot & { files: Record<string, string>; notes: string[] };
  const baseline = createdListenerCount(f.ctx);
  const start = f.driver.start(f.request({ snapshot: mutable, bind: async () => { entered.resolve(); await release.promise; } }));
  await entered.promise;
  mutable.files['main.ts'] = 'const MUTATED_INPUT = true;\n'; mutable.notes.push('MUTATED_INPUT');
  await writeFile(join(f.root, 'main.ts'), 'const MUTATED_WORKSPACE = true;\n');
  assert.equal(f.adapter.calls.length, 0);
  release.resolve();
  const attempt = await start; t.after(() => attempt.dispose());
  const result = await attempt.result;
  assert.equal(result.stopReason, 'completed'); assert.deepEqual(result.structured, { findings: [] });
  await attempt.dispose(); assertClean(f.ctx, f.parent.session.id, baseline);
});

test('allowlist hides inherited bypass schemas and execution guard blocks scoped registration', { timeout: 15_000 }, async t => {
  let bypassExecutions = 0;
  const forbidden = ['shell', 'network', 'session_query', 'subagent', 'run_code'];
  const f = await fixture(t, (options, count) => {
    for (const name of forbidden) assert.equal(options.tools?.some(tool => tool.name === name), false);
    return count === 1 ? [{ name: 'scoped_bypass', args: {} }] : [{ name: 'structured_output', args: { findings: [] } }];
  });
  const bypass = (name: string) => defineTool({ name, description: 'Forbidden reviewer bypass fixture', parameters: {},
    output: { schema: { type: 'null' }, render: () => [] }, async execute() { bypassExecutions++; return null; } });
  // run_code is a reserved transport, not a registrable tool. Give the parent
  // real PTC presentation and prove the driver resets children to native mode.
  for (const name of forbidden.filter(name => name !== 'run_code')) f.ctx.tools.register(bypass(name));
  f.parent.ctx.tools.presentAs('ptc');
  assert.ok(f.parent.ctx.tools.schemas(f.parent).some(tool => tool.name === 'run_code'));
  const observer = f.ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession?.startsWith('cross-review-controller-')) agent.ctx.tools.register(bypass('scoped_bypass'));
    return undefined;
  });
  t.after(observer);
  const baseline = createdListenerCount(f.ctx);
  const attempt = await f.driver.start(f.request()); t.after(() => attempt.dispose());
  const result = await attempt.result;
  assert.equal(bypassExecutions, 0);
  assert.equal(result.stopReason, 'completed'); assert.deepEqual(result.structured, { findings: [] });
  await attempt.dispose(); assertClean(f.ctx, f.parent.session.id, baseline);
});

test('native capture rejects schema-invalid output then accepts an explicitly empty result', { timeout: 15_000 }, async t => {
  const f = await fixture(t, (_options, count) => [{ name: 'structured_output', args: count === 1 ? { findings: [1] } : { findings: [] } }]);
  const baseline = createdListenerCount(f.ctx);
  const attempt = await f.driver.start(f.request()); t.after(() => attempt.dispose());
  const result = await attempt.result;
  assert.equal(result.stopReason, 'completed'); assert.deepEqual(result.structured, { findings: [] });
  assert.equal(f.adapter.calls.length, 2, 'invalid capture must not settle as success');
  await attempt.dispose(); assertClean(f.ctx, f.parent.session.id, baseline);
});

test('failed durable binding makes zero model calls and cleans both native identities and listeners', { timeout: 15_000 }, async t => {
  let boundIds: Parameters<NativeAttemptInput['bind']>[0] | undefined;
  const f = await fixture(t, () => assert.fail('unbound model dispatch'));
  const baseline = createdListenerCount(f.ctx); const abort = new AbortController(); const signalBaseline = getEventListeners(abort.signal, 'abort').length;
  await assert.rejects(f.driver.start(f.request({ signal: abort.signal, bind: async ids => { boundIds = ids; throw new Error('binding persistence rejected'); } })), /binding persistence rejected/);
  assert.ok(boundIds); assert.equal(f.adapter.calls.length, 0);
  assertClean(f.ctx, f.parent.session.id, baseline, abort.signal, signalBaseline);
});

test('abort before start creates no controller, child, listener, binding, or model call', { timeout: 15_000 }, async t => {
  const f = await fixture(t, () => assert.fail('pre-aborted model dispatch'));
  const abort = new AbortController(); abort.abort(new Error('cancelled before start'));
  const baseline = createdListenerCount(f.ctx); const signalBaseline = getEventListeners(abort.signal, 'abort').length;
  await assert.rejects(f.driver.start(f.request({ signal: abort.signal, bind: async () => assert.fail('binding after pre-abort') })), /cancelled before start/);
  assert.equal(f.adapter.calls.length, 0); assertClean(f.ctx, f.parent.session.id, baseline, abort.signal, signalBaseline);
});

test('abort during asynchronous binding prevents model dispatch and drains cleanup', { timeout: 15_000 }, async t => {
  const entered = deferred(); const release = deferred();
  const f = await fixture(t, () => assert.fail('model dispatch after binding abort'));
  const abort = new AbortController(); const baseline = createdListenerCount(f.ctx); const signalBaseline = getEventListeners(abort.signal, 'abort').length;
  const start = f.driver.start(f.request({ signal: abort.signal, bind: async () => { entered.resolve(); await release.promise; } }));
  // Attach rejection observer immediately; the native cancellation can reject
  // before the test releases its deliberately slow persistence callback.
  const rejected = assert.rejects(start);
  await entered.promise;
  abort.abort(new Error('cancelled during binding')); release.resolve();
  await rejected;
  assert.equal(f.adapter.calls.length, 0); assertClean(f.ctx, f.parent.session.id, baseline, abort.signal, signalBaseline);
});

for (const cancelBy of ['signal', 'dispose'] as const) {
  test(`${cancelBy} during live native request cancels and removes controllers, children, and listeners`, { timeout: 15_000 }, async t => {
    const entered = deferred(); let streamAborted = false;
    const f = await fixture(t, async options => {
      entered.resolve();
      const signal = options.signal;
      assert.ok(signal);
      await new Promise<void>((_resolve, reject) => {
        const cancel = () => { streamAborted = true; reject(signal.reason ?? new Error('native stream cancelled')); };
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
      });
      return [];
    });
    const abort = new AbortController(); const baseline = createdListenerCount(f.ctx); const signalBaseline = getEventListeners(abort.signal, 'abort').length;
    const attempt = await f.driver.start(f.request({ signal: abort.signal })); t.after(() => attempt.dispose());
    await entered.promise;
    if (cancelBy === 'signal') abort.abort(new Error('cancelled live review')); else await attempt.dispose();
    const result = await attempt.result;
    assert.notEqual(result.stopReason, 'completed'); assert.equal(result.structured, undefined);
    await Promise.all([attempt.dispose(), attempt.dispose()]);
    assert.equal(streamAborted, true); assert.equal(f.adapter.calls.length, 1);
    assertClean(f.ctx, f.parent.session.id, baseline, abort.signal, signalBaseline);
  });
}
