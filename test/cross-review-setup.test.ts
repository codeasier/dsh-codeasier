import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Approval, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import Storage from '@deepseek-ai/dsh-storage';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Host from '../src/plugins/cross-review/index.js';
import { ConfigurationService, loadFileLayers, validateRoutes } from '../src/plugins/cross-review/configuration.js';
import { parseConfig, type ConfigLayer, type ReviewConfig } from '../src/plugins/cross-review/protocol.js';

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
const configuration = (overrides: Partial<ReviewConfig> = {}): ReviewConfig => ({
  reviewers: ['a', 'b'].map(id => ({ id, provider: 'offline', model: id, focus: `Check ${id}`, maxTokens: 321 })),
  concurrency: 2, timeoutMs: 10_000, judge: { kind: 'parent' }, ...overrides,
});
const configPath = (root: string) => join(root, '.dsh', 'cross-review.json');

/** Catalog/resolution are offline; only the parent fixture may enter stream(). */
class OfflineAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  resolution: 'exact' | 'substitute' = 'exact';
  modelProvider: 'exact' | 'other' = 'exact';
  constructor(readonly nextCall: () => string | undefined) { super(); }
  override providerInfo(id: string) { return { id, name: 'Configuration fixture: no network' }; }
  override async listModels(provider: string) {
    return ['parent', 'a', 'b', 'judge'].map(id => ({ provider: this.modelProvider === 'exact' ? provider : 'other', id, name: id }));
  }
  override async resolveModel(provider: string, id: string) {
    return { provider, id: this.resolution === 'exact' ? id : 'replacement', name: id };
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.equal(options.model, 'parent', 'configuration must never dispatch a reviewer or judge');
    this.calls.push(options);
    const setupId = this.nextCall();
    if (setupId) {
      const id = ToolCallId(`configuration-fixture-${this.calls.length}`);
      const block = { type: 'tool-call' as const, id, name: 'fixture_config_save', arguments: JSON.stringify({ setupId }) };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index: 0, block };
    }
    yield { type: 'finish', reason: setupId ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}

async function fixture(t: TestContext, policy: 'ask' | 'never' | 'absent' = 'ask', hostLayers: readonly ConfigLayer[] = [], homeAtWorkspace = false) {
  const temp = await realpath(tmpdir());
  const scratch = await realpath(await mkdtemp(join(temp, 'dsh-cross-config-test-')));
  const root = join(scratch, 'repo'); const home = homeAtWorkspace ? root : join(scratch, 'home');
  await mkdir(root); if (home !== root) await mkdir(home);
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), temp);
    assert.ok(basename(scratch).startsWith('dsh-cross-config-test-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  await mountAgentLoopTestDependencies(ctx);
  if (policy !== 'absent') await ctx.plugin(Approval, { policy });
  let pendingSetupId: string | undefined;
  const adapter = new OfflineAdapter(() => { const id = pendingSetupId; pendingSetupId = undefined; return id; });
  ctx.llm.registerAdapter(['offline'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  const parent = await harness.create(SessionId(`configuration-parent-${randomUUID()}`), { provider: 'offline', model: 'parent' }, { cwd: root });
  const service = new ConfigurationService(ctx, hostLayers, home);
  ctx.tools.register(defineTool({
    name: 'fixture_config_save', description: 'Offline test entry to configuration save in the owning open turn.',
    parameters: { setupId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      assert.equal(exec.agent, parent);
      await service.save(parent, args.setupId, exec.signal, exec.callId);
      return 'saved';
    },
  }));
  async function save(setupId: string) {
    pendingSetupId = setupId;
    const done = deferred<void>();
    const stop = ctx.on('tools/result', (exec, result) => {
      if (exec.agent !== parent || exec.name !== 'fixture_config_save') return undefined;
      stop();
      if (result.isError) done.reject(new Error(result.error.message)); else done.resolve();
      return undefined;
    });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Save this frozen setup preview.' }], source: { kind: 'user' } }));
    try { await done.promise; } finally { stop(); await parent.whenIdle(); }
  }
  function approve(expected: { path: string; configuration: unknown }) {
    let requests = 0;
    parent.ctx.on('approval/request', async request => {
      requests++;
      assert.equal(request.agent, parent); assert.equal(request.toolName, 'cross_config_save');
      assert.ok(request.callId, 'save approval must retain its native tool call identity');
      assert.ok(request.reason?.includes(expected.path), 'approval must identify the exact target');
      const compact = request.reason?.replace(/\s/g, '') ?? '';
      assert.ok(compact.includes(JSON.stringify(expected.configuration).replace(/\s/g, '')), 'approval must show the complete frozen configuration');
      return 'allowed-once';
    });
    return () => requests;
  }
  async function put(scope: 'local' | 'global', value: unknown) {
    const path = configPath(scope === 'local' ? root : home);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    return path;
  }
  const noReviewers = () => {
    assert.ok(adapter.calls.every(call => call.model === 'parent'));
    assert.deepEqual(ctx.agents.list().map(agent => agent.session.id), [parent.session.id]);
  };
  return { ctx, root, home, scratch, parent, harness, service, adapter, save, approve, put, noReviewers };
}

async function absent(path: string) { await assert.rejects(lstat(path), { code: 'ENOENT' }); }

test('actual Host registers and withdraws all four setup tools without TUI or model execution', { timeout: 20_000 }, async t => {
  const f = await fixture(t); await f.ctx.plugin(Storage); await f.ctx.plugin(SubagentRuntime, { maxDepth: 2, maxActiveSubagents: 8 });
  const host = await f.ctx.plugin(Host, { root: join(f.scratch, 'host-store'), review: configuration(), preauthorizedDigests: [] });
  const names = ['cross_config_catalog', 'cross_config_preview', 'cross_config_save', 'cross_config_validate'];
  for (const name of names) assert.ok(f.ctx.tools.get(name, f.parent));
  const result = await f.ctx.tools.execute({ agent: f.parent, name: 'cross_config_catalog', arguments: {}, callId: ToolCallId(`catalog-${randomUUID()}`), signal: new AbortController().signal });
  assert.equal(result.isError, false, result.isError ? result.error.message : ''); assert.equal(typeof result.value, 'string');
  const catalog = JSON.parse(result.value as string) as { providers: { id: string; models: { provider: string; id: string }[] }[] };
  assert.ok(catalog.providers.some(provider => provider.id === 'offline' && provider.models.some(model => model.provider === 'offline' && model.id === 'a')));
  assert.equal(f.adapter.calls.length, 0); f.noReviewers();
  await host.dispose();
  for (const name of names) assert.equal(f.ctx.tools.get(name, f.parent), undefined);
});

test('catalog and setup preview are read-only, explicit, and isolated from caller mutation', async t => {
  const f = await fixture(t);
  const catalog = JSON.stringify(await f.service.catalog(f.parent));
  assert.ok(catalog.includes('offline')); assert.ok(catalog.includes('judge'));
  const input = configuration(); const expected = structuredClone(input);
  const before = await readdir(f.root); const homeBefore = await readdir(f.home);
  const plan = await f.service.preview(f.parent, 'local', input);
  assert.equal(typeof plan.setupId, 'string'); assert.ok(plan.setupId.length > 0);
  assert.equal(plan.path, configPath(f.root)); assert.equal(plan.scope, 'local'); assert.equal(plan.exists, false);
  assert.deepEqual(plan.configuration, expected); assert.deepEqual(plan.effectiveConfig, expected);
  assert.ok(plan.expiresAt > Date.now()); assert.ok(plan.sources.reviewers);
  input.reviewers[0]!.model = 'caller mutation'; input.timeoutMs = 999;
  assert.deepEqual(plan.configuration, expected); assert.deepEqual(plan.effectiveConfig, expected);
  assert.deepEqual(await readdir(f.root), before); assert.deepEqual(await readdir(f.home), homeBefore);
  assert.equal(f.adapter.calls.length, 0); f.noReviewers();
});

for (const scope of ['local', 'global'] as const) {
  test(`${scope} save uses native one-shot approval, writes mode 0600, and validates the re-read file`, { timeout: 20_000 }, async t => {
    const f = await fixture(t); const expected = configuration({ judge: { kind: 'model', provider: 'offline', model: 'judge', maxTokens: 654 } });
    const plan = await f.service.preview(f.parent, scope, expected); const requests = f.approve(plan);
    await f.save(plan.setupId);
    assert.equal(requests(), 1);
    assert.deepEqual(JSON.parse(await readFile(plan.path, 'utf8')), expected);
    const info = await lstat(plan.path); assert.ok(info.isFile()); assert.equal(info.mode & 0o777, 0o600);
    const validated = await f.service.validate(f.parent, scope);
    assert.equal(validated.path, plan.path); assert.deepEqual(validated.configuration, expected); assert.deepEqual(validated.effectiveConfig, expected);
    assert.ok(validated.sources.reviewers);
    assert.deepEqual(await readdir(dirname(plan.path)), ['cross-review.json'], 'no lock or temporary write artifact remains');
    await assert.rejects(f.save(plan.setupId), /unknown|expired|consum|stale|setup/i);
    assert.equal(requests(), 1, 'consumed setup cannot request approval a second time');
    f.noReviewers();
  });
}

test('global preview and save agree when cwd and home share the same configuration path', { timeout: 20_000 }, async t => {
  const f = await fixture(t, 'ask', [], true); assert.equal(f.home, f.root);
  await f.put('local', configuration({ timeoutMs: 111 }));
  const expected = configuration({ timeoutMs: 222 }); const plan = await f.service.preview(f.parent, 'global', expected);
  assert.equal(plan.path, configPath(f.root)); assert.equal(plan.exists, true);
  assert.deepEqual(plan.configuration, expected); assert.deepEqual(plan.effectiveConfig, expected);
  f.approve(plan); await f.save(plan.setupId);
  const validated = await f.service.validate(f.parent, 'global');
  assert.deepEqual(validated.configuration, expected); assert.deepEqual(validated.effectiveConfig, expected);
  assert.deepEqual(JSON.parse(await readFile(plan.path, 'utf8')), expected); f.noReviewers();
});

test('loader discovers only each sibling worktree fixed file, never an ancestor or another worktree', async t => {
  const f = await fixture(t); const global = configuration({ timeoutMs: 444 }); await f.put('global', global);
  const repository = join(f.scratch, 'shared-repository');
  const roots = ['first', 'second', 'empty'].map(name => join(repository, '.worktrees', name));
  for (const root of roots) await mkdir(root, { recursive: true });
  const values = [{ timeoutMs: 111 }, { timeoutMs: 222 }];
  const ancestor = configPath(repository); await mkdir(dirname(ancestor)); await writeFile(ancestor, JSON.stringify(configuration({ timeoutMs: 333 })));
  for (const [index, value] of values.entries()) {
    const path = configPath(roots[index]!); await mkdir(dirname(path)); await writeFile(path, JSON.stringify(value));
  }
  for (const [index, root] of roots.entries()) {
    const layers = await loadFileLayers(root, f.home);
    assert.deepEqual(layers.map(layer => layer.value), index < values.length ? [global, values[index]] : [global]);
    assert.deepEqual(layers.map(layer => layer.source), index < values.length
      ? [`global:${configPath(f.home)}`, `local:${configPath(root)}`]
      : [`global:${configPath(f.home)}`]);
  }
  assert.equal(f.adapter.calls.length, 0); f.noReviewers();
});

test('successful replacement is atomic and narrows an existing file to mode 0600', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const path = await f.put('local', configuration({ timeoutMs: 111 }));
  await chmod(path, 0o644); const before = await lstat(path);
  const plan = await f.service.preview(f.parent, 'local', configuration({ timeoutMs: 222 }));
  assert.equal(plan.exists, true); f.approve(plan); await f.save(plan.setupId);
  const after = await lstat(path); assert.notEqual(after.ino, before.ino, 'atomic replacement uses a fresh inode');
  assert.equal(after.mode & 0o777, 0o600); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), plan.configuration);
  assert.deepEqual((await f.service.validate(f.parent, 'local')).configuration, plan.configuration); f.noReviewers();
});

test('an unavailable native answerer creates neither target nor .dsh directory', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration());
  await assert.rejects(f.save(plan.setupId), /unavailable|authorization/i);
  await absent(plan.path); await absent(dirname(plan.path)); await absent(join(f.home, '.dsh')); f.noReviewers();
});

test('file layers load global before local; defaults, model judge merge, Host and invocation precedence stay visible', async t => {
  const host: ConfigLayer = { source: 'Host', value: { concurrency: 4, judge: { maxTokens: 777 } } };
  const f = await fixture(t, 'ask', [host]);
  const global = configuration({ concurrency: 1, timeoutMs: 12_000, judge: { kind: 'model', provider: 'offline', model: 'a', maxTokens: 111 } });
  const local = { reviewers: [{ id: 'local', provider: 'offline', model: 'b', focus: 'local focus' }], concurrency: 3, judge: { model: 'judge' } };
  await f.put('global', global); await f.put('local', local);
  const layers = await loadFileLayers(f.root, f.home);
  assert.equal(layers.length, 2); assert.deepEqual(layers[0]!.value, global); assert.deepEqual(layers[1]!.value, local);
  const expected = parseConfig([...layers, host]);
  const validated = await f.service.validate(f.parent, 'local');
  assert.deepEqual(validated.configuration, local); assert.deepEqual(validated.effectiveConfig, expected.config); assert.deepEqual(validated.sources, expected.sources);
  assert.equal(validated.effectiveConfig.concurrency, 4); assert.equal(validated.effectiveConfig.timeoutMs, 12_000);
  assert.deepEqual(validated.effectiveConfig.reviewers, local.reviewers);
  assert.deepEqual(validated.effectiveConfig.judge, { kind: 'model', provider: 'offline', model: 'judge', maxTokens: 777 });
  const invocation: ConfigLayer = { source: 'invocation', value: { timeoutMs: 456, judge: { kind: 'parent' } } };
  const merged = parseConfig([...layers, host, invocation]);
  assert.equal(merged.config.timeoutMs, 456); assert.deepEqual(merged.config.judge, { kind: 'parent' });
  assert.equal(merged.sources.timeoutMs, 'invocation'); assert.equal(merged.sources.concurrency, 'Host');
  assert.equal(merged.sources['judge.model'], undefined, 'switching to parent judge clears obsolete route provenance');
  const replacement = configuration({ concurrency: 6, timeoutMs: 789, judge: { kind: 'model', provider: 'offline', model: 'judge' } });
  const plan = await f.service.preview(f.parent, 'local', replacement);
  assert.equal(plan.exists, true); assert.deepEqual(plan.configuration, replacement);
  assert.equal(plan.effectiveConfig.concurrency, 4, 'Host wins over the candidate file configuration');
  assert.equal(plan.effectiveConfig.timeoutMs, 789); assert.equal(f.adapter.calls.length, 0); f.noReviewers();
});

test('absent files load no layers and defaults remain attributed', async t => {
  const f = await fixture(t);
  assert.deepEqual(await loadFileLayers(f.root, f.home), []);
  const plan = await f.service.preview(f.parent, 'local', { reviewers: configuration().reviewers });
  assert.equal(plan.effectiveConfig.concurrency, 2); assert.equal(plan.effectiveConfig.timeoutMs, 120_000);
  assert.deepEqual(plan.effectiveConfig.judge, { kind: 'parent' });
  assert.equal(plan.configuration.timeoutMs, 120_000, 'setup materializes defaults into the selected file');
  assert.equal(plan.sources.timeoutMs, `local:${plan.path}`);
  await absent(configPath(f.root)); await absent(configPath(f.home));
  await f.put('local', { reviewers: configuration().reviewers });
  const validated = await f.service.validate(f.parent, 'local');
  assert.equal(validated.effectiveConfig.timeoutMs, 120_000); assert.equal(validated.sources.timeoutMs, 'default');
  assert.equal(f.adapter.calls.length, 0);
});

for (const [label, input] of [
  ['unknown field', { ...configuration(), credentials: 'must not be persisted' }],
  ['empty reviewers', configuration({ reviewers: [] })],
  ['duplicate reviewer id', configuration({ reviewers: [configuration().reviewers[0]!, configuration().reviewers[0]!] })],
  ['nonpositive concurrency', configuration({ concurrency: 0 })],
  ['nonpositive timeout', configuration({ timeoutMs: 0 })],
  ['whitespace route', configuration({ reviewers: [{ id: 'a', provider: 'offline', model: ' a ', focus: 'check' }] })],
] as const) {
  test(`preview rejects malformed configuration: ${label}`, async t => {
    const f = await fixture(t);
    await assert.rejects(f.service.preview(f.parent, 'local', input));
    await absent(configPath(f.root)); assert.equal(f.adapter.calls.length, 0); f.noReviewers();
  });
}

for (const mode of ['provider', 'model', 'catalog-provider', 'substitution', 'judge'] as const) {
  test(`route validation rejects ${mode} without streaming`, async t => {
    const f = await fixture(t); let input = configuration();
    if (mode === 'provider') input.reviewers[0]!.provider = 'unavailable';
    if (mode === 'model') input.reviewers[0]!.model = 'a-alias';
    if (mode === 'catalog-provider') f.adapter.modelProvider = 'other';
    if (mode === 'substitution') f.adapter.resolution = 'substitute';
    if (mode === 'judge') input = configuration({ judge: { kind: 'model', provider: 'offline', model: 'missing-judge' } });
    await assert.rejects(validateRoutes(f.ctx, input), /provider|model|route|resolution/i);
    await assert.rejects(f.service.preview(f.parent, 'local', input), /provider|model|route|resolution/i);
    assert.equal(f.adapter.calls.length, 0); await absent(configPath(f.root)); f.noReviewers();
  });
}

test('loader and validate reject malformed JSON and unknown configuration keys without rewriting bytes', async t => {
  const f = await fixture(t); const path = await f.put('local', configuration());
  for (const text of ['{not json', JSON.stringify({ ...configuration(), unexpected: true })]) {
    await writeFile(path, text);
    await assert.rejects(loadFileLayers(f.root, f.home)); await assert.rejects(f.service.validate(f.parent, 'local'));
    assert.equal(await readFile(path, 'utf8'), text);
  }
  assert.equal(f.adapter.calls.length, 0);
});

for (const mode of ['never', 'absent', 'rejected', 'unavailable', 'cancelled'] as const) {
  test(`save authorization ${mode} cannot modify the target`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, mode === 'never' || mode === 'absent' ? mode : 'ask');
    const original = configuration({ timeoutMs: 111 }); const path = await f.put('local', original); const before = await readFile(path, 'utf8');
    const plan = await f.service.preview(f.parent, 'local', configuration({ timeoutMs: 222 }));
    let requests = 0;
    f.parent.ctx.on('approval/request', async () => { requests++; return mode === 'rejected' || mode === 'unavailable' || mode === 'cancelled' ? mode : 'allowed-once'; });
    await assert.rejects(f.save(plan.setupId), /authorization|approval|rejected|unavailable|policy|allowed|denied/i);
    if (mode === 'never' || mode === 'absent') assert.equal(requests, 0);
    assert.equal(await readFile(path, 'utf8'), before); f.noReviewers();
  });
}

test('save requires an open owning turn even when an approval listener allows once', async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration());
  f.approve(plan);
  await assert.rejects(f.service.save(f.parent, plan.setupId, new AbortController().signal), /turn|unavailable|approval|authorization/i);
  await absent(plan.path); assert.equal(f.adapter.calls.length, 0); f.noReviewers();
});

test('setup plans reject unknown IDs, other owners and forged live-agent identities', async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration());
  const impostor = Object.create(f.parent) as Agent;
  await assert.rejects(f.service.catalog(impostor), /live|agent|owner/i);
  await assert.rejects(f.service.preview(impostor, 'local', configuration()), /live|agent|owner/i);
  await assert.rejects(f.service.validate(impostor, 'local'), /live|agent|owner/i);
  await assert.rejects(f.service.save(impostor, plan.setupId, new AbortController().signal), /live|agent|owner/i);
  const other = await f.harness.create(SessionId(`configuration-other-${randomUUID()}`), { provider: 'offline', model: 'parent' }, { cwd: f.root });
  await assert.rejects(f.service.save(other, plan.setupId, new AbortController().signal), /owner|unknown|unowned|setup/i);
  await assert.rejects(f.save(randomUUID()), /unknown|expired|setup/i);
  await absent(plan.path); assert.equal(f.adapter.calls.filter(call => call.model !== 'parent').length, 0);
});

for (const mode of ['existing-changed', 'absent-created'] as const) {
  test(`save rejects frozen target digest mismatch: ${mode}`, { timeout: 20_000 }, async t => {
    const f = await fixture(t);
    if (mode === 'existing-changed') await f.put('local', configuration({ timeoutMs: 111 }));
    const plan = await f.service.preview(f.parent, 'local', configuration({ timeoutMs: 222 })); f.approve(plan);
    await f.put('local', configuration({ timeoutMs: 333 })); const before = await readFile(plan.path, 'utf8');
    await assert.rejects(f.save(plan.setupId), /changed|digest|stale|exist|conflict/i);
    assert.equal(await readFile(plan.path, 'utf8'), before); f.noReviewers();
  });
}

test('expired preview and pre-cancelled save fail before approval or writes', async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration());
  const abort = new AbortController(); abort.abort(new Error('fixture cancelled'));
  await assert.rejects(f.service.save(f.parent, plan.setupId, abort.signal), /cancel/i);
  const clock = t.mock.method(Date, 'now', () => plan.expiresAt + 1);
  try { await assert.rejects(f.service.save(f.parent, plan.setupId, new AbortController().signal), /expired|unknown|setup/i); }
  finally { clock.mock.restore(); }
  await absent(plan.path); assert.equal(f.adapter.calls.length, 0);
});

test('changed non-target file layer invalidates the frozen effective configuration', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const globalPath = await f.put('global', configuration({ timeoutMs: 111 }));
  const plan = await f.service.preview(f.parent, 'local', configuration({ timeoutMs: 222 })); f.approve(plan);
  await f.put('global', configuration({ timeoutMs: 333 })); const bytes = await readFile(globalPath, 'utf8');
  await assert.rejects(f.save(plan.setupId), /layers|changed|stale/i);
  await absent(plan.path); assert.equal(await readFile(globalPath, 'utf8'), bytes); f.noReviewers();
});

for (const scope of ['local', 'global'] as const) {
  test(`${scope} save rejects a symlinked native lock and preserves its referent`, { timeout: 20_000 }, async t => {
    const f = await fixture(t); const plan = await f.service.preview(f.parent, scope, configuration());
    const sentinel = join(f.scratch, 'lock-sentinel'); await writeFile(sentinel, 'do not touch\n');
    await mkdir(dirname(plan.path)); await symlink(sentinel, `${plan.path}.lock`); f.approve(plan);
    await assert.rejects(f.save(plan.setupId), /unsafe|symlink|symbolic|path/i);
    await absent(plan.path); assert.equal(await readFile(sentinel, 'utf8'), 'do not touch\n');
    assert.ok((await lstat(`${plan.path}.lock`)).isSymbolicLink()); f.noReviewers();
  });
}

test('target mutation while native approval is pending is detected before atomic write', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const path = await f.put('local', configuration({ timeoutMs: 111 }));
  const plan = await f.service.preview(f.parent, 'local', configuration({ timeoutMs: 222 }));
  const external = JSON.stringify(configuration({ timeoutMs: 333 }));
  f.parent.ctx.on('approval/request', async request => {
    assert.equal(request.toolName, 'cross_config_save'); await writeFile(path, external); return 'allowed-once';
  });
  await assert.rejects(f.save(plan.setupId), /changed|digest|stale|conflict/i);
  assert.equal(await readFile(path, 'utf8'), external); f.noReviewers();
});

test('cancellation while approval is pending does not write configuration', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const entered = deferred(); const plan = await f.service.preview(f.parent, 'local', configuration());
  f.parent.ctx.on('approval/request', async request => {
    const signal = request.signal; assert.ok(signal); entered.resolve();
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error('cancelled'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    return 'allowed-once';
  });
  const saving = f.save(plan.setupId); const rejected = assert.rejects(saving, /cancel|abort/i);
  await entered.promise; f.parent.cancel({ kind: 'user' }); await rejected;
  await absent(plan.path); f.noReviewers();
});

test('service disposal cancels and drains pending native approval with no write or late grant', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration());
  const entered = deferred(); const answererStopped = deferred(); let approvalSignal: AbortSignal | undefined;
  const nativeSettled = deferred(); const releaseNativeReturn = deferred();
  const nativeRequest = f.ctx.approval.request.bind(f.ctx.approval);
  t.mock.method(f.ctx.approval, 'request', async (request: ApprovalRequest) => {
    const outcome = await nativeRequest(request);
    nativeSettled.resolve(); await releaseNativeReturn.promise;
    return outcome;
  });
  f.parent.ctx.on('approval/request', async request => {
    assert.equal(request.toolName, 'cross_config_save'); approvalSignal = request.signal; assert.ok(approvalSignal);
    const signal = approvalSignal; entered.resolve();
    await new Promise<void>(resolve => {
      if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
    });
    answererStopped.resolve();
    return 'allowed-once'; // Deliberately late grant; native cancellation remains authoritative.
  });
  const saving = f.save(plan.setupId); const rejected = assert.rejects(saving, /cancel|abort|disposed/i);
  await entered.promise;
  let disposed = false;
  const disposing = f.service.dispose().then(() => { disposed = true; });
  await nativeSettled.promise;
  await Promise.resolve();
  assert.ok(approvalSignal?.aborted, 'dispose must withdraw the in-flight native approval');
  try { assert.equal(disposed, false, 'dispose must drain the tracked save before returning'); }
  finally { releaseNativeReturn.resolve(); }
  await disposing; await answererStopped.promise; await rejected;
  await absent(plan.path); await absent(dirname(plan.path));
  await assert.rejects(f.service.preview(f.parent, 'local', configuration()), /live|agent|closing|disposed/i);
  await f.service.dispose(); // Disposal is safe to repeat after the tracked save drained.
  f.noReviewers();
});

test('post-write runtime validation failure rejects save but preserves the complete committed file', { timeout: 20_000 }, async t => {
  const f = await fixture(t); const plan = await f.service.preview(f.parent, 'local', configuration()); f.approve(plan);
  const original = f.adapter.listModels.bind(f.adapter); let postWriteChecks = 0;
  const catalog = t.mock.method(f.adapter, 'listModels', async (provider: string) => {
    let written = false;
    try { written = (await lstat(plan.path)).isFile(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (written) { postWriteChecks++; throw new Error('fixture post-write runtime catalog failure'); }
    return original(provider);
  });
  await assert.rejects(f.save(plan.setupId), /post-write runtime catalog failure/i);
  assert.equal(postWriteChecks, 1, 'failure must occur during the required post-write revalidation');
  assert.deepEqual(JSON.parse(await readFile(plan.path, 'utf8')), plan.configuration, 'committed selection is preserved, not rolled back');
  assert.equal((await lstat(plan.path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dirname(plan.path)), ['cross-review.json'], 'failed validation still releases lock and temporary files');
  catalog.mock.restore();
  assert.deepEqual((await f.service.validate(f.parent, 'local')).configuration, plan.configuration);
  await assert.rejects(f.save(plan.setupId), /unknown|expired|consum|stale|setup/i); f.noReviewers();
});

for (const kind of ['invalid-utf8', 'over-one-mib'] as const) {
  test(`loader, preview and validation reject ${kind} without changing bytes`, async t => {
    const f = await fixture(t); const path = await f.put('local', configuration());
    const json = Buffer.from(JSON.stringify(configuration()));
    const bytes = kind === 'invalid-utf8'
      ? Buffer.from(json)
      : Buffer.concat([json, Buffer.alloc(1024 * 1024 + 1 - json.length, 0x20)]);
    if (kind === 'invalid-utf8') {
      const index = bytes.indexOf('Check a'); assert.ok(index >= 0); bytes[index] = 0xff;
      // A lossy UTF-8 decoder would produce valid JSON here, so syntax rejection is insufficient.
      assert.doesNotThrow(() => JSON.parse(bytes.toString('utf8')));
    } else assert.equal(bytes.length, 1024 * 1024 + 1);
    await writeFile(path, bytes);
    const reason = kind === 'invalid-utf8' ? /encoding|encoded|utf.?8/i : /oversized|size|large/i;
    await assert.rejects(loadFileLayers(f.root, f.home), reason);
    await assert.rejects(f.service.preview(f.parent, 'local', configuration()), reason);
    await assert.rejects(f.service.validate(f.parent, 'local'), reason);
    assert.deepEqual(await readFile(path), bytes); assert.equal(f.adapter.calls.length, 0); f.noReviewers();
  });
}

for (const scope of ['local', 'global'] as const) {
  test(`${scope} hardlinked target is unsafe even when its contents are valid`, async t => {
    const f = await fixture(t); const path = await f.put(scope, configuration()); const original = await readFile(path);
    const sibling = join(f.scratch, 'shared-config.json'); await absent(sibling); await link(path, sibling);
    assert.equal((await lstat(path)).nlink, 2);
    await assert.rejects(loadFileLayers(f.root, f.home), /unsafe|link|regular|path/i);
    await assert.rejects(f.service.preview(f.parent, scope, configuration()), /unsafe|link|regular|path/i);
    await assert.rejects(f.service.validate(f.parent, scope), /unsafe|link|regular|path/i);
    assert.deepEqual(await readFile(path), original); assert.deepEqual(await readFile(sibling), original);
    assert.equal((await lstat(path)).nlink, 2); assert.equal(f.adapter.calls.length, 0); f.noReviewers();
  });
}

for (const scope of ['local', 'global'] as const) {
  for (const kind of ['root-link', 'parent-link', 'target-link', 'dangling-target', 'directory-target'] as const) {
    test(`${scope} configuration rejects ${kind} without following or modifying it`, async t => {
      const f = await fixture(t); const root = scope === 'local' ? f.root : f.home;
      const outside = join(f.scratch, 'outside'); await mkdir(outside);
      const sentinel = join(outside, 'sentinel.json'); const bytes = JSON.stringify(configuration()); await writeFile(sentinel, bytes);
      if (kind === 'root-link') {
        assert.equal(await realpath(root), root); assert.equal(dirname(root), f.scratch);
        const moved = join(f.scratch, `${scope}-real`); await absent(moved); await rename(root, moved); await symlink(moved, root);
      }
      else if (kind === 'parent-link') await symlink(outside, join(root, '.dsh'));
      else {
        await mkdir(join(root, '.dsh'));
        if (kind === 'directory-target') await mkdir(configPath(root));
        else await symlink(kind === 'target-link' ? sentinel : join(outside, 'absent.json'), configPath(root));
      }
      await assert.rejects(loadFileLayers(f.root, f.home), /symbolic|symlink|regular|directory|unsafe|path/i);
      await assert.rejects(f.service.preview(f.parent, scope, configuration()), /symbolic|symlink|regular|directory|unsafe|path/i);
      await assert.rejects(f.service.validate(f.parent, scope), /symbolic|symlink|regular|directory|unsafe|path/i);
      assert.equal(await readFile(sentinel, 'utf8'), bytes); await absent(join(outside, 'absent.json'));
      assert.equal(f.adapter.calls.length, 0); f.noReviewers();
    });
  }
}
