import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Sessions, { Session, SessionId, foldSurface, deriveEventMessage } from '@deepseek-ai/dsh-session';
import { LlmAdapter, HarnessError, ToolCallId, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';

// Public dependency resolution through its owner; never import unpublished helpers.
// See plugin-repository.test.mjs for the same DSH-owned transitive resolution seam.
const require = createRequire(import.meta.url);
const dshRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const publicImport = name => import(pathToFileURL(dshRequire.resolve(name)).href);
const { default: QuerySqlite } = await publicImport('@deepseek-ai/dsh-session-query-sqlite');
const { default: Jsonl } = await publicImport('@deepseek-ai/dsh-session-persistence-jsonl');
const { SessionPersistence } = await publicImport('@deepseek-ai/dsh-session-persistence');
const { buildSessionEventRecords } = await publicImport('@deepseek-ai/dsh-session-query');
const { currentSessionMessageProjections } = await publicImport('@deepseek-ai/dsh-session-format-catalog/message-projections');
const { compactCheckpointSource, isCompactCheckpointSource } = await publicImport('@deepseek-ai/dsh-compaction/checkpoint');
const text = value => [{ type: 'text', text: value }];
const user = value => createUserMessage({ content: text(value), source: { kind: 'user' } });
const assistant = content => createAssistantMessage({ content, source: { provider: 'offline', model: 'scripted' } });
const appendUser = (session, value) => session.append('user/message', user(value), { surfaceOp: 'append' });
const code = expected => error => error.code === expected;

async function fixture(t, { persistence = true, search = false, loop = false } = {}) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'dsh-session-query-contract-')));
  const contexts = [];
  t.after(async () => {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose();
    assert.equal(resolve(root), root); assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('dsh-session-query-contract-'));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  async function mount() {
    const ctx = new Context(); contexts.push(ctx);
    if (loop) await mountAgentLoopTestDependencies(ctx);
    else await ctx.plugin(Sessions);
    if (persistence) await ctx.plugin(Jsonl, { root: join(root, 'logs'), compression: 'none' });
    await ctx.plugin(QuerySqlite, { path: ':memory:', openAt: search ? 'startup' : 'never', snippetChars: 32 });
    return ctx;
  }
  return { root, ctx: await mount(), mount };
}
async function store(ctx, header, events, options) {
  const handle = await ctx.sessionPersistence.create(header, options);
  try { if (events.length) await handle.append(events); await handle.flush(); }
  finally { await handle.close(); }
}
async function stored(ctx, id) {
  const handle = await ctx.sessionPersistence.open(SessionId(id), 'read');
  try { return (await handle.read()).events; } finally { await handle.close(); }
}
function seed(id, values, meta = {}) {
  const session = Session.create(SessionId(id), undefined, { version: 4, id: SessionId(id), createdAt: 1, isSeeded: false, ...meta });
  const events = values.map(value => appendUser(session, value));
  return { session, events };
}
function surfaceAt(events) {
  const folded = foldSurface(events, currentSessionMessageProjections);
  return { folded, messages: folded.nodes.map(seq => deriveEventMessage(events[seq], folded.projectedMessages)).filter(Boolean) };
}

// Deliberately TEST-ONLY policy probe, NOT native authorization or a shipped tool.
// Exact caller/target grants must precede any metadata or content query.
async function grantedRead(query, caller, target, grants) {
  if (typeof target !== 'string' || !target.trim() || target !== target.trim()) return { error: 'EXPLICIT_TARGET_REQUIRED' };
  if (!grants.has(JSON.stringify([caller, target]))) return { error: 'SESSION_ACCESS_DENIED' };
  if (!query) return { error: 'SESSION_QUERY_UNAVAILABLE' };
  return query.readSession(SessionId(target));
}

// TEST-ONLY budget experiment for a follow-up normalizer, not an implementation.
// Two independent loss axes: per-fragment clipping and whole-message selection.
function budgetProbe(messages, maxMessages, maxPartBytes) {
  const retained = messages.slice(0, maxMessages).map(message => ({ ...message, content: message.content.map(block => {
    if (block.type !== 'text' || Buffer.byteLength(block.text) <= maxPartBytes) return block;
    let preview = ''; const marker = '...[truncated]';
    assert.ok(maxPartBytes >= Buffer.byteLength(marker));
    for (const point of block.text) {
      if (Buffer.byteLength(preview + point + marker) > maxPartBytes) break;
      preview += point;
    }
    return { type: 'text', text: preview + marker, clipped: true };
  }) }));
  return { messages: retained, retainedMessageIDs: retained.map(message => message.id), totalMessages: messages.length,
    includedMessages: retained.length, omittedMessages: messages.length - retained.length,
    partsTruncated: retained.some(message => message.content.some(block => block.clipped)), messagesOmitted: retained.length < messages.length };
}

class ScriptedLLM extends LlmAdapter {
  calls = [];
  constructor(script) { super(); this.script = script; }
  providerInfo(id) { return { id, name: 'scriptedLLM (offline, no credentials)' }; }
  async resolveModel(provider, id) { return { provider, id, name: id }; }
  async *stream(options) {
    this.calls.push(options);
    yield* this.script(options, this.calls.length);
  }
}
function* callStream(calls) {
  for (const [index, call] of calls.entries()) {
    const block = { type: 'tool-call', id: ToolCallId(`script-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
    yield { type: 'block-start', index, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
    yield { type: 'block-end', index, block };
  }
  yield { type: 'finish', reason: { kind: 'tool-calls' } };
}
function* textStream(value) {
  yield { type: 'block-start', index: 0, blockType: 'reasoning' };
  yield { type: 'reasoning-delta', index: 0, text: 'scripted-reasoning-evidence' };
  yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'scripted-reasoning-evidence' } };
  yield { type: 'block-start', index: 1, blockType: 'text' };
  yield { type: 'text-delta', index: 1, text: value };
  yield { type: 'block-end', index: 1, block: { type: 'text', text: value } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

test('SQ1: installed public package versions and exported query methods are pinned', async () => {
  for (const name of ['dsh', 'dsh-session', 'dsh-session-query', 'dsh-session-query-sqlite', 'dsh-session-persistence', 'dsh-session-persistence-jsonl', 'dsh-session-format-catalog', 'dsh-compaction', 'dsh-llm', 'dsh-tools', 'dsh-agent-loop-testkit']) {
    const pkg = JSON.parse(await readFile(dshRequire.resolve(`@deepseek-ai/${name}/package.json`), 'utf8'));
    assert.equal(pkg.version, '0.2.0-rc.2', name);
  }
  assert.equal(JSON.parse(await readFile(require.resolve('@deepseek-ai/cordis/package.json'), 'utf8')).version, '4.0.4');
  for (const method of ['readSession', 'observeSession', 'readSurface']) assert.equal(typeof QuerySqlite.prototype[method], 'function');
});

test('SQ2: missing query composition, missing persistence, unknown target and empty session are distinguishable', async t => {
  const f = await fixture(t, { persistence: false });
  const bare = new Context(); t.after(() => bare.fiber.dispose()); await bare.plugin(Sessions);
  assert.equal(bare.get('sessionQuery'), undefined);
  assert.deepEqual(await grantedRead(undefined, 'owner', 'exact', new Set(['["owner","exact"]'])), { error: 'SESSION_QUERY_UNAVAILABLE' });
  await assert.rejects(f.ctx.sessionQuery.readSession(SessionId('missing')), code('SESSION_QUERY_SESSION_NOT_FOUND'));
  await assert.rejects(f.ctx.sessionQuery.observeSession(SessionId('missing')), code('SESSION_QUERY_SESSION_NOT_FOUND'));
  f.ctx.sessions.create(SessionId('empty'));
  assert.deepEqual((await f.ctx.sessionQuery.readSession(SessionId('empty'))).events, []);
  await assert.rejects(f.ctx.sessionQuery.searchSessions({ query: 'anything' }), code('SESSION_QUERY_SEARCH_DISABLED'));
});

test('SQ3: trusted service reads same-cwd peers, children and foreign cwd; metadata is not caller authorization', async t => {
  const { ctx, root } = await fixture(t);
  const owner = ctx.sessions.create(SessionId('owner'), { meta: { cwd: root } });
  const peer = ctx.sessions.create(SessionId('peer'), { meta: { cwd: root } });
  const child = ctx.sessions.create(SessionId('child'), { meta: { cwd: root, parentSession: owner.id } });
  const foreign = ctx.sessions.create(SessionId('foreign'), { meta: { cwd: join(root, 'other-project') } });
  for (const session of [owner, peer, child, foreign]) appendUser(session, `evidence-${session.id}`);
  for (const session of [peer, child, foreign]) {
    const snapshot = await ctx.sessionQuery.readSession(session.id);
    assert.equal(snapshot.session.id, session.id);
    assert.ok(JSON.stringify(snapshot.events).includes(`evidence-${session.id}`));
  }
  assert.equal((await ctx.sessionQuery.readSession(child.id)).session.parentSession, owner.id);
  const matching = await ctx.sessionQuery.filterSessions([{ kind: 'cwd', values: [root] }]);
  assert.deepEqual(matching.map(record => record.header.id).sort(), ['child', 'owner', 'peer']);
});

test('SQ4: TEST-ONLY caller/target gate denies without querying or revealing existence; no implicit selection', async t => {
  const { ctx } = await fixture(t);
  const session = ctx.sessions.create(SessionId('secret')); appendUser(session, 'PRIVATE-FIXTURE-CONTENT');
  let reads = 0;
  const query = { async readSession(id) { reads++; return ctx.sessionQuery.readSession(id); } };
  const grants = new Set(['["owner","secret"]']);
  for (const target of [undefined, '', ' ', ' secret']) assert.deepEqual(await grantedRead(query, 'owner', target, grants), { error: 'EXPLICIT_TARGET_REQUIRED' });
  for (const target of ['secret', 'absent']) assert.deepEqual(await grantedRead(query, 'stranger', target, grants), { error: 'SESSION_ACCESS_DENIED' });
  assert.equal(reads, 0);
  const permitted = await grantedRead(query, 'owner', 'secret', grants);
  assert.equal(permitted.session.id, 'secret'); assert.equal(reads, 1);
});

test('SQ5: live wins over older persisted copy; read results are detached', async t => {
  const { ctx, root } = await fixture(t);
  const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: root } });
  const first = appendUser(session, 'persisted-prefix'); await store(ctx, session.header, [first]);
  appendUser(session, 'live-only-tail');
  const read = await ctx.sessionQuery.readSession(session.id);
  assert.equal(read.events.length, 2); assert.equal((await stored(ctx, session.id)).length, 1);
  read.session.cwd = '/changed'; read.events[0].data = user('changed');
  const again = await ctx.sessionQuery.readSession(session.id);
  assert.equal(again.session.cwd, root); assert.equal(again.events[0].data.content[0].text, 'persisted-prefix');
  const lease = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' });
  try { assert.equal(lease.source, 'live'); assert.equal(lease.cursor, 1); } finally { lease[Symbol.dispose](); }
});

test('SQ6: reopened JSONL cold read and prepared lease never attach an Agent or Session', async t => {
  const f = await fixture(t); const source = seed('cold', ['stored-goal', 'stored-outcome'], { cwd: f.root });
  await store(f.ctx, source.session.header, source.events); await f.ctx.fiber.dispose();
  const ctx = await f.mount(); assert.equal(ctx.sessions.get(source.session.id), undefined);
  const read = await ctx.sessionQuery.readSession(source.session.id);
  assert.deepEqual(read.events, source.events); assert.equal(read.inheritedEventCount, 0);
  const lease = await ctx.sessionQuery.observeSession(source.session.id, { projectionMode: 'none' });
  try {
    assert.equal(lease.source, 'prepared'); assert.equal(lease.cursor, 1); assert.ok(lease.revision);
    assert.deepEqual(lease.events, source.events);
    const retained = lease.retain(); retained[Symbol.dispose]();
  } finally { lease[Symbol.dispose](); }
  assert.equal(ctx.sessions.get(source.session.id), undefined);
});

test('SQ7: unavailable persistence produces typed failures but cannot break a known live read', async t => {
  const { ctx } = await fixture(t, { persistence: false });
  class FailedPersistence extends SessionPersistence {
    async list() { throw new Error('fixture backend unavailable'); }
    async stat() { throw new Error('fixture backend unavailable'); }
    async open() { throw new Error('fixture backend unavailable'); }
  }
  await ctx.plugin(FailedPersistence);
  const session = ctx.sessions.create(SessionId('still-live')); appendUser(session, 'available');
  assert.equal((await ctx.sessionQuery.readSession(session.id)).events.length, 1);
  const lease = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' }); lease[Symbol.dispose]();
  await assert.rejects(ctx.sessionQuery.readSession(SessionId('cold')), code('SESSION_QUERY_PERSISTENCE_FAILED'));
  await assert.rejects(ctx.sessionQuery.observeSession(SessionId('cold')), code('SESSION_QUERY_PERSISTENCE_FAILED'));
});

test('SQ8: observation fixes one lazy live cut for raw logs and current surface; separate calls need not match', async t => {
  const { ctx } = await fixture(t);
  const session = ctx.sessions.create(SessionId('cut')); appendUser(session, 'at-cut');
  const lease = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' });
  try {
    appendUser(session, 'after-cut');
    assert.equal(lease.cursor, 0); assert.equal(lease.events.length, 1);
    const { folded, messages } = surfaceAt(lease.events);
    assert.deepEqual(folded.nodes, [0]); assert.equal(messages[0].content[0].text, 'at-cut');
    assert.equal((await ctx.sessionQuery.readSurface(session.id)).capturedThroughSeq, 1);
    assert.equal(lease.events.length, 1);
  } finally { lease[Symbol.dispose](); }
});

test('SQ9: cold interrupted closers are synthesized in memory, not persisted outcomes or recovery', async t => {
  const { ctx } = await fixture(t); const source = seed('crashed', []); const s = source.session;
  const events = [s.append('turn/start', { turn: 1 }), s.append('step/start', { turn: 1, step: 1 })];
  const calls = [ToolCallId('started'), ToolCallId('not-started')];
  events.push(s.append('assistant/message', { turn: 1, step: 1, message: assistant(calls.map(id => ({ type: 'tool-call', id, name: 'side_effect', arguments: '{}' }))), stream: [] }, { surfaceOp: 'append' }));
  events.push(s.append('tool/call', { turn: 1, step: 1, callId: calls[0], name: 'side_effect', arguments: '{}' }));
  await store(ctx, s.header, events);
  const before = await ctx.sessionPersistence.stat(s.id); const raw = await stored(ctx, s.id);
  const read = await ctx.sessionQuery.readSession(s.id);
  const errors = read.events.filter(event => event.type === 'tool/result');
  assert.deepEqual(errors.map(event => event.data.error.code).sort(), ['TOOL_NOT_STARTED', 'TOOL_OUTCOME_UNKNOWN']);
  assert.ok(errors.every(event => event.data.message.isError));
  assert.equal(read.events.at(-1).data.reason.kind, 'interrupted');
  assert.equal(read.events.length, raw.length + 4);
  const lease = await ctx.sessionQuery.observeSession(s.id, { projectionMode: 'none' });
  try { assert.equal(lease.source, 'prepared'); assert.deepEqual(lease.events, read.events); }
  finally { lease[Symbol.dispose](); }
  assert.deepEqual(await stored(ctx, s.id), raw);
  assert.equal((await ctx.sessionPersistence.stat(s.id)).revision, before.revision);
  assert.equal(ctx.sessions.get(s.id), undefined);
});

test('SQ10: compaction-shaped public records preserve shadowed raw evidence while current surface condenses it', async t => {
  const { ctx } = await fixture(t); const s = ctx.sessions.create(SessionId('compact'));
  const first = appendUser(s, 'original-goal'); const second = appendUser(s, 'original-action');
  const recent = appendUser(s, 'recent-tail'); const compactionId = 'fixture-compaction';
  s.append('compaction/start', { compactionId, turn: null });
  s.append('compaction/summary', { compactionId, summary: text('condensed'), shadowedRange: { start: first.seq, end: second.seq },
    shadowedSeqs: [first.seq, second.seq], shadowedTokenCount: 10, provider: 'offline', model: 'template' });
  const checkpoint = s.append('user/message', createUserMessage({ content: text('condensed'), source: compactCheckpointSource(compactionId) }),
    { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: second.seq }, sourceEventSeqs: [first.seq, second.seq] });
  s.append('compaction/end', { compactionId, turn: null });
  const lease = await ctx.sessionQuery.observeSession(s.id, { projectionMode: 'none' });
  try {
    const records = buildSessionEventRecords(s.id, lease.events);
    assert.deepEqual(records.slice(0, 3).map(record => record.surface), ['shadowed', 'shadowed', 'current']);
    assert.equal(records[3].surface, 'log-only'); assert.equal(records[4].surface, 'log-only');
    const { folded, messages } = surfaceAt(lease.events);
    assert.deepEqual(folded.nodes, [checkpoint.seq, recent.seq]);
    assert.ok(isCompactCheckpointSource(messages[0].source));
    assert.ok(JSON.stringify(lease.events).includes('original-action'));
    assert.equal(JSON.stringify(messages).includes('original-action'), false);
    const exact = await ctx.sessionQuery.readSurface(s.id);
    assert.equal(exact.capturedThroughSeq, lease.cursor); assert.deepEqual(exact.events.map(event => event.seq), folded.nodes);
  } finally { lease[Symbol.dispose](); }
});

test('SQ11: production loop with scriptedLLM retains successful/failed/unknown tool calls and results', { timeout: 15000 }, async t => {
  const { ctx, root } = await fixture(t, { loop: true });
  const adapter = new ScriptedLLM((_options, count) => count === 1
    ? callStream([{ name: 'ok_tool', args: { value: 'raw-argument' } }, { name: 'fail_tool', args: {} }, { name: 'unknown_tool', args: {} }])
    : textStream('offline-final'));
  ctx.llm.registerAdapter(['offline'], adapter);
  ctx.tools.register(defineTool({ name: 'ok_tool', description: 'offline success', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute() { return 'actual-tool-result'; } }));
  ctx.tools.register(defineTool({ name: 'fail_tool', description: 'offline failure', parameters: {}, output: { schema: { type: 'null' }, render: () => [] },
    async execute() { throw new HarnessError('scripted-tool-failure', 'FIXTURE_FAILURE'); } }));
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('scripted-tools'), { provider: 'offline', model: 'scripted' }, { cwd: root });
  agent.followup(user('exercise tools offline')); await agent.whenIdle(); await ctx.sessions.flush(agent.session);
  const read = await ctx.sessionQuery.readSession(agent.session.id);
  const calls = read.events.filter(event => event.type === 'tool/call'); const results = read.events.filter(event => event.type === 'tool/result');
  assert.deepEqual(calls.map(event => event.data.name).sort(), ['fail_tool', 'ok_tool', 'unknown_tool']);
  assert.equal(results.length, 3);
  for (const call of calls) assert.ok(results.some(event => event.data.message.toolCallId === call.data.callId));
  assert.ok(results.some(event => JSON.stringify(event.data.message.content).includes('actual-tool-result')), JSON.stringify(results));
  assert.ok(results.some(event => event.data.error?.code === 'FIXTURE_FAILURE' && event.data.message.isError));
  assert.ok(results.some(event => event.data.error?.code === 'UNKNOWN_TOOL' && event.data.message.isError));
  assert.ok(JSON.stringify(read.events).includes('raw-argument')); assert.ok(JSON.stringify(read.events).includes('offline-final'));
  assert.equal(adapter.calls.length, 2);
  assert.ok(read.events.some(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'reasoning' && block.text === 'scripted-reasoning-evidence')));
  assert.equal((await ctx.sessionQuery.filterEvents(agent.session.id, [{ kind: 'text', text: 'scripted-reasoning-evidence' }])).length, 0);
  assert.deepEqual(await stored(ctx, agent.session.id), read.events);
});

test('SQ12: failed assistant attempt keeps partial stream and terminal error outside current surface', { timeout: 15000 }, async t => {
  const { ctx, root } = await fixture(t, { loop: true });
  const adapter = new ScriptedLLM(function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'partial-failed-prefix' };
    throw new HarnessError('offline attempt rejected', 'INVALID_CREDENTIAL');
  });
  ctx.llm.registerAdapter(['offline'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('failed-attempt'), { provider: 'offline', model: 'scripted' }, { cwd: root });
  agent.followup(user('fail offline')); await agent.whenIdle(); await ctx.sessions.flush(agent.session);
  const read = await ctx.sessionQuery.readSession(agent.session.id);
  const attempt = read.events.find(event => event.type === 'assistant/attempt');
  assert.ok(attempt); assert.ok(JSON.stringify(attempt.data.stream).includes('partial-failed-prefix'));
  assert.equal(read.events.at(-1).data.reason.kind, 'error');
  const surface = await ctx.sessionQuery.readSurface(agent.session.id);
  assert.equal(surface.events.some(event => event.type === 'assistant/attempt'), false);
  assert.equal(JSON.stringify(surface.events).includes('partial-failed-prefix'), false);
  assert.equal(adapter.calls.length, 1);
});

test('SQ13: unknown ignorable event survives raw cold read but is not semantic message/search evidence', async t => {
  const f = await fixture(t); const ctx = f.ctx; const source = seed('unknown-event', ['known']);
  const unknown = { seq: 1, time: 2, type: 'future/opaque', data: { content: 'unknown-payload' }, ignorable: true };
  await store(ctx, source.session.header, [...source.events, unknown]);
  const read = await ctx.sessionQuery.readSession(source.session.id);
  assert.deepEqual(read.events[1], unknown); assert.deepEqual(surfaceAt(read.events).folded.nodes, [0]);
  assert.equal((await ctx.sessionQuery.filterEvents(source.session.id, [{ kind: 'text', text: 'unknown-payload' }])).length, 0);
  const required = seed('required-unknown', []); const handle = await ctx.sessionPersistence.create(required.session.header);
  const { ignorable: _ignorable, ...requiredEvent } = unknown;
  try { await handle.append([{ ...requiredEvent, seq: 0 }]); await handle.flush(); } finally { await handle.close(); }
  // Trusted appends/cache accept extension vocabulary; test disk admission after reopening.
  await ctx.fiber.dispose(); const reopened = await f.mount();
  assert.deepEqual((await reopened.sessionQuery.readSession(source.session.id)).events[1], unknown);
  await assert.rejects(stored(reopened, required.session.id), error => error.name === 'SessionFormatUnsupportedError');
  await assert.rejects(reopened.sessionQuery.readSession(required.session.id), code('SESSION_QUERY_PERSISTENCE_FAILED'));
});

test('SQ14: exact reads do not clip long fragments or omit messages; search snippets/pages are not full evidence', async t => {
  const { ctx } = await fixture(t, { search: true }); const s = ctx.sessions.create(SessionId('long'));
  const long = `needle ${'证据🙂'.repeat(7000)} tail-proof`;
  const original = appendUser(s, long);
  for (let index = 0; index < 204; index++) appendUser(s, `needle message-${index}`);
  const read = await ctx.sessionQuery.readSession(s.id);
  assert.equal(read.events.length, 205); assert.equal(read.events[0].data.content[0].text, long);
  const surface = await ctx.sessionQuery.readSurface(s.id);
  assert.equal(surface.events.length, 205);
  const page = await ctx.sessionQuery.searchEvents({ sessionId: s.id, query: 'needle', limit: 1 });
  assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
  assert.ok([...page.items[0].snippet].length <= 32);
  const fragment = await ctx.sessionQuery.searchEvents({ sessionId: s.id, query: 'tail-proof', limit: 1 });
  assert.equal(fragment.items.length, 1); assert.equal(fragment.items[0].seq, original.seq);
  assert.ok([...fragment.items[0].snippet].length <= 32);
  assert.ok(fragment.items[0].snippet.includes('tail-proof'));
  assert.notEqual(fragment.items[0].snippet, long);
  assert.equal((await ctx.sessionQuery.readSession(s.id)).events[0].data.id, original.data.id);
});

test('SQ18: native monotonic tool guard denies exact-target access before body with existence-neutral results', { timeout: 15000 }, async t => {
  const { ctx, root } = await fixture(t, { loop: true });
  const secret = ctx.sessions.create(SessionId('guard-secret'), { meta: { cwd: root } }); appendUser(secret, 'GUARD-SECRET-CONTENT');
  const adapter = new ScriptedLLM((_options, count) => count === 1 ? callStream([
    { name: 'fixture_session_read', args: { target: 'guard-secret' } },
    { name: 'fixture_session_read', args: { target: 'guard-absent' } },
    { name: 'fixture_session_read', args: { target: 'guard-caller' } },
  ]) : textStream('guard-done'));
  ctx.llm.registerAdapter(['offline'], adapter);
  let reads = 0;
  ctx.tools.register(defineTool({ name: 'fixture_session_read', description: 'TEST-ONLY trusted read bridge, not a shipped tool',
    parameters: { target: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) { reads++; return JSON.stringify(await ctx.sessionQuery.readSession(SessionId(args.target))); } }));
  ctx.tools.guard(exec => exec.name === 'fixture_session_read' && !(exec.agent.session.id === 'guard-caller' && exec.arguments.target === 'guard-caller')
    ? 'SESSION_ACCESS_DENIED' : undefined);
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('guard-caller'), { provider: 'offline', model: 'scripted' }, { cwd: root });
  agent.followup(user('exercise native authorization guard')); await agent.whenIdle();
  const read = await ctx.sessionQuery.readSession(agent.session.id);
  const results = read.events.filter(event => event.type === 'tool/result');
  assert.equal(reads, 1); assert.equal(results.length, 3);
  const denied = results.filter(event => event.data.message.isError);
  assert.equal(denied.length, 2);
  assert.deepEqual(denied[0].data.message.content, denied[1].data.message.content);
  assert.deepEqual(denied[0].data.message.content, text('Error: SESSION_ACCESS_DENIED'));
  assert.equal(JSON.stringify(results).includes('GUARD-SECRET-CONTENT'), false);
});

test('SQ16: conflicting source headers are not merged; live exact reads still prefer live', async t => {
  const { ctx, root } = await fixture(t);
  const durable = seed('conflict', ['old'], { cwd: root }); await store(ctx, durable.session.header, durable.events);
  const live = ctx.sessions.create(durable.session.id, { meta: { cwd: join(root, 'different'), createdAt: 1 } }); appendUser(live, 'live');
  await assert.rejects(ctx.sessionQuery.listSessions(), code('SESSION_QUERY_SOURCE_CONFLICT'));
  assert.equal((await ctx.sessionQuery.readSession(live.id)).events[0].data.content[0].text, 'live');
});

test('SQ17: exact inherited cut survives live and persisted-not-loaded fork observations', async t => {
  const { ctx, root } = await fixture(t);
  const parent = ctx.sessions.create(SessionId('fork-parent'), { meta: { cwd: root } }); appendUser(parent, 'inherited');
  const parentRead = await ctx.sessionQuery.readSession(parent.id);
  const child = ctx.sessions.prepare(SessionId('fork-child'), { seed: parentRead.events, inheritedEventCount: 1,
    meta: { cwd: root, parentSession: parent.id, isSeeded: true } });
  const owned = appendUser(child, 'child-owned');
  const dispose = ctx.sessions.enter(child); ctx.sessions.announce(child);
  const read = await ctx.sessionQuery.readSession(child.id);
  assert.equal(read.inheritedEventCount, 1); assert.equal(read.events[1].type, 'session/end-seed');
  assert.equal(owned.seq, 2); await store(ctx, child.header, read.events, { inheritedEventCount: read.inheritedEventCount }); dispose();
  const lease = await ctx.sessionQuery.observeSession(child.id, { projectionMode: 'none' });
  try {
    assert.equal(lease.source, 'prepared'); assert.equal(lease.inheritedEventCount, 1);
    assert.equal(lease.header.parentSession, parent.id); assert.equal(lease.events[2].data.content[0].text, 'child-owned');
  } finally { lease[Symbol.dispose](); }
  assert.equal(ctx.sessions.get(child.id), undefined);
});

test('SQ15: TEST-ONLY bounded report probe distinguishes fragment clipping from whole-message omission', async t => {
  const { ctx } = await fixture(t); const s = ctx.sessions.create(SessionId('budget'));
  appendUser(s, '证据🙂'.repeat(20)); appendUser(s, 'second'); appendUser(s, 'third');
  const lease = await ctx.sessionQuery.observeSession(s.id, { projectionMode: 'none' });
  try {
    const { messages } = surfaceAt(lease.events);
    const partsOnly = budgetProbe(messages, 3, 32);
    assert.equal(partsOnly.partsTruncated, true); assert.equal(partsOnly.messagesOmitted, false); assert.equal(partsOnly.omittedMessages, 0);
    assert.ok(Buffer.byteLength(partsOnly.messages[0].content[0].text) <= 32);
    assert.equal(partsOnly.messages[0].content[0].text.includes('\uFFFD'), false);
    const omitOnly = budgetProbe(messages, 1, 1000);
    assert.equal(omitOnly.partsTruncated, false); assert.equal(omitOnly.messagesOmitted, true); assert.equal(omitOnly.omittedMessages, 2);
    assert.deepEqual(omitOnly.retainedMessageIDs, [messages[0].id]);
    const both = budgetProbe(messages, 1, 32); assert.equal(both.partsTruncated, true); assert.equal(both.messagesOmitted, true);
    assert.equal(messages[0].content[0].text, '证据🙂'.repeat(20));
  } finally { lease[Symbol.dispose](); }
});
