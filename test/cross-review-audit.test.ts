import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import Approval from '@deepseek-ai/dsh-user-approval';
import { SessionId } from '@deepseek-ai/dsh-session';
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import * as Host from '../src/plugins/cross-review/index.js';
import * as Audit from '../src/plugins/cross-review-audit/index.js';
import { prepareEvidence } from '../src/plugins/cross-review/evidence.js';
import { openReviewStore } from '../src/plugins/cross-review/store.js';
import { parseRecord, type RunRecord } from '../src/plugins/cross-review/records.js';
import { parseConfig } from '../src/plugins/cross-review/protocol.js';
import { canonicalFindingId } from '../src/plugins/cross-review/judge.js';

class NoCalls extends LlmAdapter {
  calls = 0;
  script?: (options: GenerateOptions) => { name: string; args: unknown }[];
  override providerInfo(id: string) { return { id, name: 'Offline audit fixture' }; }
  override async listModels(provider: string) { return [{ provider, id: 'fixture', name: 'fixture' }]; }
  override async resolveModel(provider: string, id: string) { return { provider, id, name: id }; }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++;
    if (!this.script) throw new Error('Audit must never call models');
    const calls = this.script(options);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call' as const, id: ToolCallId(`audit-fixture-${this.calls}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}
async function fixture(t: TestContext, unresolved = false, clockOffset = 0) {
  const temporary = await realpath(tmpdir()); const scratch = await realpath(await mkdtemp(join(temporary, 'dsh-audit-test-')));
  const root = join(scratch, 'repo'); await mkdir(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
  git('init', '-q'); await writeFile(join(root, 'main.ts'), 'export const VALUE = 1;\n'); git('add', 'main.ts'); git('commit', '-qm', 'fixture');
  const snapshot = await prepareEvidence({ kind: 'local', root });
  const { config, sources } = parseConfig([{ source: 'fixture', value: { reviewers: [{ id: 'a', provider: 'offline', model: 'fixture', focus: 'safety' }] } }]);
  const now = Date.now() + clockOffset;
  const record = parseRecord({ id: randomUUID(), revision: 0, schemaVersion: 1, policyVersion: 1,
    owner: { sessionId: 'audit-parent', project: root, workspaceCwd: root, runtimeId: randomUUID() }, config, sources, snapshot,
    state: 'completed', attempts: [{ id: randomUUID(), reviewerId: 'a', provider: 'offline', model: 'fixture', kind: 'reviewer', state: 'completed', childId: 'released-native-child', controllerId: 'released-controller', snapshotId: snapshot.id, result: { findings: [] } }], decisions: [],
    authorization: { digest: createHash('sha256').update(JSON.stringify({ project: root, config, snapshotId: snapshot.id, schemaVersion: 1, policyVersion: 1 })).digest('hex'), mode: 'interactive', outcome: 'allowed-once', approvedAt: now, approvalPolicy: 'ask' },
    cancellationIntent: false, deadline: now + config.timeoutMs, createdAt: now, updatedAt: now, audit: [{ at: now, action: 'authorized', detail: 'Offline confirmed-result fixture, not a real model run' }] });
  const ctx = new Context(); await mountAgentLoopTestDependencies(ctx); await ctx.plugin(Storage); await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 8 });
  const adapter = new NoCalls(); ctx.llm.registerAdapter(['offline'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx); const parent = await harness.create(SessionId('audit-parent'), { provider: 'offline', model: 'fixture' }, { cwd: root });
  const storeRoot = join(scratch, 'store'); const store = await openReviewStore(ctx, storeRoot);
  await store.put(unresolved ? parseRecord({ ...record, state: 'running', attempts: record.attempts.map(({ id, reviewerId, provider, model, kind }) => ({ id, reviewerId, provider, model, kind, state: 'pending' })) }) : record);
  await store.close();
  const host = await ctx.plugin(Host, { root: storeRoot, review: config, preauthorizedDigests: [] });
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), temporary); assert.ok(basename(scratch).startsWith('dsh-audit-test-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  return { ctx, parent, harness, host, adapter, record: await ctx.crossReview.status(parent, record.id), storeRoot };
}
const check = (result: Audit.AuditResult, id: string) => { const found = result.checks.find(c => c.id === id); assert.ok(found, id); return found; };

test('actual Host/tool mounting, native schema, owner-only repeated reads and independent disposal', async t => {
  const f = await fixture(t); const plugin = await f.ctx.plugin(Audit, {});
  assert.equal(f.ctx.get('tuiPluginHost', false), undefined); assert.equal(f.ctx.tools.get('cross_review_audit', f.parent)?.name, 'cross_review_audit');
  const before = await f.ctx.crossReview.status(f.parent, f.record.id); const report = await f.ctx.crossReview.report(f.parent, f.record.id);
  await assert.rejects(Audit.auditRun({ status: async () => assert.fail('invalid input must reject before observation'), report: async () => assert.fail('invalid input must reject before observation') }, f.parent, 'prefix', new AbortController().signal));
  await assert.rejects(Audit.auditRun({ status: async () => ({ ...before, id: randomUUID() }), report: async () => assert.fail('unbound status must reject before report') }, f.parent, before.id, new AbortController().signal), /different run identity/);
  const invoke = (agent = f.parent, args: unknown = { runId: f.record.id }, signal = new AbortController().signal) => f.ctx.tools.execute({ agent, name: 'cross_review_audit', arguments: args, callId: ToolCallId(randomUUID()), signal });
  for (let i = 0; i < 3; i++) {
    const value = await invoke(); assert.equal(value.isError, false, value.isError ? value.error.message : '');
    const result = JSON.parse(value.value as string) as Audit.AuditResult;
    assert.deepEqual(result.binding, { runId: before.id, revision: before.revision, snapshotId: before.snapshot.id });
    assert.equal(result.summary.anomaly, 0); assert.equal(check(result, 'report.consistency').result, 'pass');
    assert.equal(check(result, 'attempt.history').result, 'cannot-verify');
    assert.ok(result.checks.every(c => c.sources.length && c.facts !== undefined));
    assert.equal(JSON.stringify(result).includes('export const VALUE'), false, 'audit does not echo snapshot contents');
  }
  const intruder = await f.harness.create(SessionId('audit-other'), { provider: 'offline', model: 'fixture' }, { cwd: f.record.owner.project });
  assert.equal((await invoke(intruder)).isError, true);
  await assert.rejects(Audit.auditRun(f.ctx.crossReview, { session: f.parent.session } as typeof f.parent, f.record.id, new AbortController().signal), /exact live owning Agent/);
  const noAgent = await f.ctx.tools.execute({ name: 'cross_review_audit', arguments: { runId: f.record.id }, callId: ToolCallId(randomUUID()), signal: new AbortController().signal });
  assert.equal(noAgent.isError, true);
  for (const args of [{}, { runId: 42 }, { runId: 'prefix-only' }, { runId: f.record.id, replay: true }]) assert.equal((await invoke(f.parent, args)).isError, true);
  const abort = new AbortController(); abort.abort(new Error('aborted audit')); assert.equal((await invoke(f.parent, { runId: f.record.id }, abort.signal)).isError, true);
  assert.deepEqual(await f.ctx.crossReview.status(f.parent, f.record.id), before); assert.deepEqual(await f.ctx.crossReview.report(f.parent, f.record.id), report); assert.equal(f.adapter.calls, 0);
  await plugin.dispose(); assert.equal(f.ctx.tools.get('cross_review_audit', f.parent), undefined); assert.ok(f.ctx.tools.get('cross_review_report', f.parent));
  assert.throws(() => Audit.apply(f.ctx, { replay: true }));
  await f.host.dispose(); assert.throws(() => Audit.apply(f.ctx, {}), /unavailable/);
});

test('genuine offline native run audits after normal child release with no extra model requests', { timeout: 20_000 }, async t => {
  const f = await fixture(t); await f.ctx.plugin(Approval, { policy: 'ask' }); await f.ctx.plugin(Spawn, { providerName: 'spawn' });
  f.parent.ctx.on('approval/request', async () => 'allowed-once');
  const plan = await f.ctx.crossReview.preview(f.parent, { kind: 'local', root: f.record.owner.project });
  let started = false;
  f.adapter.script = request => request.sessionId === f.parent.session.id
    ? started ? [] : (started = true, [{ name: 'cross_review_start', args: { planId: plan.id } }])
    : [{ name: 'structured_output', args: { findings: [] } }];
  const completed = new Promise<RunRecord>(resolveCompleted => {
    const stop = f.ctx.crossReview.subscribe(record => { if (record.id !== f.record.id && record.state === 'completed') { stop(); resolveCompleted(record); } });
  });
  f.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the offline native fixture.' }], source: { kind: 'user' } }));
  await f.parent.whenIdle(); const record = await completed;
  assert.ok(record.attempts.every(a => a.childId && a.controllerId));
  assert.deepEqual(f.ctx.agents.list().map(agent => agent.session.id), [f.parent.session.id], 'genuine native children have been released normally');
  await f.ctx.plugin(Audit, {}); const before = f.adapter.calls;
  const receipt = await f.ctx.tools.execute({ agent: f.parent, name: 'cross_review_audit', arguments: { runId: record.id }, callId: ToolCallId(randomUUID()), signal: new AbortController().signal });
  assert.equal(receipt.isError, false, receipt.isError ? receipt.error.message : '');
  const result = JSON.parse(receipt.value as string) as Audit.AuditResult;
  assert.equal(result.summary.anomaly, 0); assert.equal(check(result, 'attempt.history').result, 'cannot-verify');
  assert.equal(check(result, 'report.consistency').result, 'pass'); assert.equal(f.adapter.calls, before);
});

test('actual Host recovery of a legal future-dated record does not turn clock discontinuity into a violation', async t => {
  const f = await fixture(t, false, 60_000); const record = f.record;
  assert.ok(record.updatedAt < record.createdAt); assert.ok(record.audit.at(-1)!.at < record.audit[0]!.at);
  assert.equal(record.audit.at(-1)!.action, 'recovered'); assert.deepEqual(parseRecord(record), record);
  await f.ctx.plugin(Audit, {});
  const receipt = await f.ctx.tools.execute({ agent: f.parent, name: 'cross_review_audit', arguments: { runId: record.id }, callId: ToolCallId(randomUUID()), signal: new AbortController().signal });
  assert.equal(receipt.isError, false, receipt.isError ? receipt.error.message : '');
  const result = JSON.parse(receipt.value as string) as Audit.AuditResult;
  assert.equal(result.summary.anomaly, 0); assert.equal(check(result, 'revision.timeline').result, 'insufficient-evidence');
  assert.equal(check(result, 'report.consistency').result, 'pass'); assert.equal(f.adapter.calls, 0);
});

test('pure inspector distinguishes normal pending, cancellation, interruption, recovery and missing provenance', async t => {
  const f = await fixture(t);
  for (const state of ['running', 'awaiting_timeout', 'awaiting_judge', 'interrupted', 'cancelled', 'failed'] as const) {
    const record = structuredClone(f.record); record.state = state; record.cancellationIntent = state === 'cancelled';
    if (state === 'awaiting_judge') {
      record.attempts[0]!.result!.findings = [{ id: 'local', title: 'fixture', body: 'fixture', severity: 'low', path: 'main.ts', startLine: 1, endLine: 1, quote: 'export const VALUE = 1;' }];
    }
    assert.equal(Audit.inspectAuditSnapshot({ record }).summary.anomaly, 0, state);
  }
  const record = structuredClone(f.record); record.sources = {};
  assert.equal(check(Audit.inspectAuditSnapshot({ record }), 'config.provenance').result, 'insufficient-evidence');
  const unknown = { ...f.record, schemaVersion: 2 };
  assert.equal(check(Audit.inspectAuditSnapshot({ record: unknown }), 'contract.version').result, 'cannot-verify');
  const rollback = structuredClone(f.record); rollback.updatedAt = rollback.createdAt - 1;
  const clockResult = Audit.inspectAuditSnapshot({ record: rollback });
  assert.equal(clockResult.summary.anomaly, 0); assert.equal(check(clockResult, 'revision.timeline').result, 'insufficient-evidence');
});

test('pure inspector reports concrete anomalous identities, evidence, authorization, routes, revision and decisions', async t => {
  const f = await fixture(t);
  const mutations: [string, (r: any) => void][] = [
    ['attempt.binding', r => { r.attempts[0].snapshotId = 'wrong'; }],
    ['attempt.identities', r => { r.attempts.push({ ...r.attempts[0] }); }],
    ['attempt.routes', r => { r.attempts[0].model = 'substitution'; }],
    ['authorization.digest', r => { r.authorization.digest = '0'.repeat(64); }],
    ['cancellation', r => { r.state = 'cancelled'; }],
    ['record.validation', r => { r.revision = -1; }],
    ['recovery', r => { r.state = 'running'; r.attempts[0].state = 'running'; delete r.attempts[0].result; }],
    ['completion.quorum', r => { r.attempts[0].state = 'failed'; delete r.attempts[0].result; }],
    ['judgment', r => { r.decisions = [{ findingId: 'unknown', verdict: 'verified', reason: 'unsupported' }]; }],
  ];
  for (const [id, mutate] of mutations) {
    const record = structuredClone(f.record); mutate(record);
    assert.equal(check(Audit.inspectAuditSnapshot({ record }), id).result, 'anomaly', id);
  }
  const tampered: any = structuredClone(f.record); tampered.snapshot.files['main.ts'] = 'tampered';
  assert.equal(check(Audit.inspectAuditSnapshot({ record: tampered }), 'record.validation').result, 'anomaly');
  const record = structuredClone(f.record); const finding = { id: 'local', title: 'fixture', body: 'fixture', severity: 'low' as const, path: 'main.ts', startLine: 1, endLine: 1, quote: 'export const VALUE = 1;' };
  record.attempts[0]!.result = { findings: [finding] };
  assert.equal(check(Audit.inspectAuditSnapshot({ record }), 'completion.pending').result, 'anomaly');
  record.decisions = [{ findingId: canonicalFindingId(finding), verdict: 'verified', reason: 'Offline fixture independent verification' }];
  assert.equal(Audit.inspectAuditSnapshot({ record }).summary.anomaly, 0);
  record.config.judge = { kind: 'model', provider: 'offline', model: 'fixture' };
  record.authorization.digest = createHash('sha256').update(JSON.stringify({ project: record.owner.project, config: record.config, snapshotId: record.snapshot.id, schemaVersion: 1, policyVersion: 1 })).digest('hex');
  assert.equal(check(Audit.inspectAuditSnapshot({ record }), 'judgment').result, 'anomaly', 'model judging needs a confirmed judge decision source');
  record.attempts.push({ id: randomUUID(), reviewerId: 'judge', kind: 'judge', provider: 'offline', model: 'fixture', state: 'completed', childId: 'released-judge-child', controllerId: 'released-judge-controller', snapshotId: record.snapshot.id, decisions: [...record.decisions] });
  assert.equal(Audit.inspectAuditSnapshot({ record }).summary.anomaly, 0, 'normal confirmed model judgment');
  record.attempts.at(-1)!.decisions = [];
  assert.equal(check(Audit.inspectAuditSnapshot({ record }), 'judgment').result, 'anomaly');
});

test('report comparison is bound to one revision; concurrent service reads never invent a violation', async t => {
  const f = await fixture(t); const record = f.record; const report = await f.ctx.crossReview.report(f.parent, record.id);
  const callerReport = structuredClone(report); const detached = Audit.inspectAuditSnapshot({ record, report: callerReport });
  assert.equal(Object.isFrozen(callerReport), false); assert.equal(Object.isFrozen(callerReport.audit), false);
  callerReport.complete = false;
  assert.equal((check(detached, 'report.consistency').facts as { observed: typeof report }).observed.complete, true);
  for (const change of [(r: any) => { r.reviewerCompleted = 0; }, (r: any) => { r.runId = randomUUID(); }, (r: any) => { r.snapshotId = 'unbound'; }, (r: any) => { r.complete = false; }, (r: any) => { r.state = 'cancelled'; }, (r: any) => { r.audit = []; }]) {
    const changed = structuredClone(report); change(changed);
    assert.equal(check(Audit.inspectAuditSnapshot({ record, report: changed }), 'report.consistency').result, 'anomaly');
  }
  for (const changed of [{ ...report, revision: report.revision + 1, complete: false }, { ...report, revision: report.revision - 1, reviewerCompleted: 0 }]) {
    const result = Audit.inspectAuditSnapshot({ record, report: changed });
    assert.equal(result.summary.anomaly, 0); assert.equal(check(result, 'report.consistency').result, 'insufficient-evidence');
  }
  const active = await fixture(t, true);
  let entered!: () => void; let release!: () => void;
  const began = new Promise<void>(r => { entered = r; }); const barrier = new Promise<void>(r => { release = r; });
  const reader: Audit.ReviewObservation = { status: (agent, id) => active.ctx.crossReview.status(agent, id), report: async (agent, id) => { entered(); await barrier; return active.ctx.crossReview.report(agent, id); } };
  const reading = Audit.auditRun(reader, active.parent, active.record.id, new AbortController().signal);
  await began;
  // A real owner control writes a revision while the independent report read waits.
  const cancelled = await active.ctx.crossReview.cancel(active.parent, { runId: active.record.id, expectedRevision: active.record.revision });
  release(); const result = await reading;
  assert.equal(result.summary.anomaly, 0); assert.equal(check(result, 'report.consistency').result, 'insufficient-evidence');
  assert.equal(result.binding.revision, active.record.revision); assert.equal(result.reportBinding?.revision, cancelled.revision);
  const cleaned = await Audit.auditRun({ status: async (agent, id) => { const current = await f.ctx.crossReview.status(agent, id); await f.ctx.crossReview.cleanup(agent, { runId: id, expectedRevision: current.revision }); return current; }, report: (agent, id) => f.ctx.crossReview.report(agent, id) }, f.parent, record.id, new AbortController().signal);
  assert.equal(cleaned.summary.anomaly, 0); assert.equal(check(cleaned, 'report.read').result, 'cannot-verify');
  await assert.rejects(Audit.auditRun({ status: async () => { throw new Error('Validated storage read rejected'); }, report: async () => assert.fail('must not read report') }, f.parent, record.id, new AbortController().signal), /storage read rejected/);
});

for (const corruption of ['unknown-version', 'invalid-binding'] as const) {
  test(`real durable ${corruption} causes store-open read failure, not a fabricated audit`, async t => {
    const f = await fixture(t); await f.host.dispose();
    const files = (await readdir(f.storeRoot)).filter(name => name.endsWith('.json')); assert.equal(files.length, 1);
    const path = join(f.storeRoot, files[0]!); const document = JSON.parse(await readFile(path, 'utf8')); let changed = 0;
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.id === f.record.id && node.attempts) { changed++; if (corruption === 'unknown-version') node.schemaVersion = 2; else node.attempts[0].snapshotId = 'invalid'; }
      for (const child of Object.values(node)) visit(child);
    };
    visit(document); assert.equal(changed, 1); await writeFile(path, JSON.stringify(document));
    await assert.rejects(openReviewStore(f.ctx, f.storeRoot));
    assert.equal(f.ctx.get('crossReview', false), undefined); assert.equal(f.adapter.calls, 0);
  });
}

test('real validated store rejects abnormal and unknown-version fixtures before audit inspection', async t => {
  const f = await fixture(t); await f.host.dispose();
  const store = await openReviewStore(f.ctx, f.storeRoot); t.after(() => store.close());
  for (const mutate of [(r: any) => { r.schemaVersion = 2; }, (r: any) => { r.attempts[0].snapshotId = 'wrong'; }, (r: any) => { r.attempts[0].model = 'changed'; }]) {
    const record = structuredClone(f.record); record.id = randomUUID(); mutate(record); await assert.rejects(store.put(record)); assert.equal(store.get(record.id), undefined);
  }
});
