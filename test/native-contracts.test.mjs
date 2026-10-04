import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';

// Only this scripted adapter is mounted. No credentials, external provider,
// network, profile, or private persistence database participates in these tests.
class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.calls = []; }
  providerInfo(id) { return { id, name: 'Contract fixture (no network)' }; }
  async resolveModel(provider, id) { return { provider, id, name: id }; }
  async *stream(options) {
    this.calls.push(options);
    const calls = await this.script(options, this.calls.length);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call', id: ToolCallId(`fixture-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}

async function fixture(t, script, tools = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await mountAgentLoopTestDependencies(ctx, { tools });
  const adapter = new ScriptedAdapter(script);
  ctx.llm.registerAdapter(['fixture'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SubagentRuntime, { maxDepth: 1, maxActiveSubagents: 8 });
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  const parent = await harness.create(SessionId('contract-parent'), { provider: 'fixture', model: 'fixture-model' }, { cwd: process.cwd() });
  return { ctx, adapter, parent };
}

const schema = { type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } }, required: ['findings'], additionalProperties: false };
const request = (parent, signal, label = 'attempt-token') => ({ parent, signal, label, prompt: [{ type: 'text', text: 'Review the immutable fixture; return findings.' }], agentOptions: { provider: 'fixture', model: 'fixture-model' }, toolFilter: { allow: [] }, outputSchema: schema, maxDepth: 1 });

function registerEvidence(child, bound, observations) {
  child.ctx.tools.presentAs('native');
  child.ctx.tools.guard(exec => {
    if (!bound.has(exec.agent.session.id)) return 'evidence not bound';
    if (!['evidence_read', 'structured_output'].includes(exec.name)) return 'reviewer tool not authorized';
  });
  child.ctx.tools.register(defineTool({
    name: 'evidence_read', description: 'Read the fixed contract evidence.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      assert.ok(bound.has(exec.agent.session.id));
      observations.push(exec.agent.session.id);
      return bound.get(exec.agent.session.id);
    },
  }));
}

test('native spawn binds exact identity at the awaited request barrier and captures a valid empty result', async t => {
  const bound = new Map();
  const reads = [];
  let childId;
  let bindingPersisted = false;
  const { ctx, adapter, parent } = await fixture(t, (_options, n) => {
    assert.equal(bindingPersisted, true, 'model dispatch must follow durable binding');
    return n === 1 ? [{ name: 'evidence_read', args: {} }] : [{ name: 'structured_output', args: { findings: [] } }];
  });
  ctx.tools.register(defineTool({ name: 'generic_shell', description: 'Forbidden bypass.', parameters: {}, output: { schema: { type: 'null' }, render: () => [] }, async execute() { assert.fail('shell bypass executed'); } }));
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.parentSession !== parent.session.id) return;
    childId = agent.session.id;
    registerEvidence(agent, bound, reads);
    agent.ctx.on('agent/request', async ({ agent: exact }, next) => {
      const identity = ctx.sessionProjections.snapshot(exact.session).values.subagent;
      assert.equal(identity?.mode, 'one-shot');
      assert.equal(identity?.label, 'attempt-token');
      assert.equal(exact.session.isOwnSeq(identity.seq), true);
      assert.equal(ctx.agents.isOwnedBy(exact.session.id, parent), true);
      // Stand-in for the durable write boundary; production must await storage.
      await Promise.resolve();
      bound.set(exact.session.id, 'immutable snapshot bytes');
      bindingPersisted = true;
      return next();
    });
  });
  const run = await ctx.subagents.start('spawn', request(parent, new AbortController().signal));
  t.after(() => run.dispose());
  const result = await run.result;
  assert.equal(run.id, childId);
  assert.equal(result.stopReason, 'completed');
  assert.deepEqual(result.structured, { findings: [] });
  assert.deepEqual(reads, [childId]);
  assert.deepEqual(adapter.calls[0].tools.map(tool => tool.name).sort(), ['evidence_read', 'structured_output']);
  assert.ok(adapter.calls[0].messages.some(m => m.role === 'user' && m.content.some(block => block.type === 'text' && block.text === 'Review the immutable fixture; return findings.')));
  await run.dispose();
  assert.equal(ctx.agents.get(childId), undefined);
});

test('binding failure prevents the first model call and cannot count toward quorum', async t => {
  const { ctx, adapter, parent } = await fixture(t, () => { assert.fail('unbound model dispatched'); });
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.parentSession !== parent.session.id) return;
    registerEvidence(agent, new Map(), []);
    agent.ctx.on('agent/request', async () => { throw new Error('durable evidence binding failed'); });
  });
  const run = await ctx.subagents.start('spawn', request(parent, new AbortController().signal));
  t.after(() => run.dispose());
  const result = await run.result;
  assert.notEqual(result.stopReason, 'completed');
  assert.equal(result.structured, undefined);
  assert.equal(adapter.calls.length, 0);
});

test('execution guard blocks scoped bypass registrations while preserving native structured capture', async t => {
  let bypassCalls = 0;
  const { ctx, parent } = await fixture(t, (_options, n) => n === 1 ? [{ name: 'scoped_bypass', args: {} }] : [{ name: 'structured_output', args: { findings: [] } }]);
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.parentSession !== parent.session.id) return;
    const bound = new Map([[agent.session.id, 'snapshot']]);
    registerEvidence(agent, bound, []);
    agent.ctx.tools.register(defineTool({ name: 'scoped_bypass', description: 'Must be denied even when scoped.', parameters: {}, output: { schema: { type: 'null' }, render: () => [] }, async execute() { bypassCalls++; return null; } }));
  });
  const run = await ctx.subagents.start('spawn', request(parent, new AbortController().signal));
  t.after(() => run.dispose());
  const result = await run.result;
  assert.equal(bypassCalls, 0);
  assert.equal(result.stopReason, 'completed');
  assert.deepEqual(result.structured, { findings: [] });
});
