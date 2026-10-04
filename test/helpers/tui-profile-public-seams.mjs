import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import * as Extensions from '@deepseek-harness-tui/dsh-tui/extensions';
import * as PluginHost from '@deepseek-harness-tui/dsh-tui/plugin-host';
import Scenes from '@deepseek-harness-tui/dsh-tui/scenes';
import { mountTuiAdapter } from '../../src/tui.ts';

// Deliberately only a seam probe, not a full profile or native-review substitute.
const ctx = new Context();
let subscribers = 0;
ctx.provide('crossReview', { subscribe() { subscribers++; return () => { subscribers--; }; } });
try {
  await mountAgentLoopTestDependencies(ctx);
  class NoCalls extends LlmAdapter {
    providerInfo(id) { return { id, name: 'No-call TUI seam fixture' }; }
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream() { throw new Error('No model calls permitted in seam probe'); }
  }
  ctx.llm.registerAdapter(['fixture'], new NoCalls());
  const harness = await mountAgentLoopTestHarness(ctx);
  const parent = await harness.create(SessionId('isolated-tui-owner'), { provider: 'fixture', model: 'fixture' }, { cwd: process.cwd() });
  await ctx.plugin(CommandRuntime);
  await ctx.plugin(Extensions);
  await ctx.plugin(Scenes);
  await ctx.plugin(PluginHost);
  const host = ctx.get('tuiPluginHost', false);
  assert.ok(host && ctx.get('tuiStatus', false) && ctx.get('tuiScenes', false));
  assert.ok(Array.isArray(host.selfCheck()));
  const descriptor = host.hostDescriptor();
  assert.ok(descriptor.contracts.some(value => value.apiVersion === 'commands.dsh/v1alpha1' && value.kind === 'Command'));
  let handle;
  const consumer = await ctx.plugin({ name: 'isolated-unadmitted-consumer', apply(scope) { handle = mountTuiAdapter(scope); return handle.dispose; } });
  assert.ok(handle);
  assert.equal(handle.capabilities.command, false);
  assert.ok(handle.capabilities.issues.length > 0);
  const progress = handle.capabilities.progress;
  const scene = handle.capabilities.scene;
  await consumer.dispose();
  assert.equal(subscribers, 0);
  await ctx.plugin(Loader, { baseUrl: new URL('../../', import.meta.url).href });
  ctx.loader.enableLogs = true;
  let importOutcome;
  const facetUrl = new URL('../../dist/tui.js', import.meta.url).href;
  try { const module = await ctx.loader.import(facetUrl); importOutcome = { exports: Object.keys(module ?? {}) }; }
  catch (error) { importOutcome = { error: error instanceof Error ? error.message : String(error) }; }
  const entryId = await ctx.loader.create({ name: facetUrl });
  await ctx.loader.await();
  const entry = ctx.loader.resolve(entryId);
  const command = ctx.commands.find(parent, 'review');
  if (command) {
    const result = await ctx.commands.execute(parent, '/review help', [], new AbortController().signal);
    assert.equal(result?.result.kind, 'success');
  }
  let grantProbe;
  try { grantProbe = { allowed: host.grants.allows(entry.fiber?.ctx ?? entry.context, 'commands.invoke', 'cross-review-control') }; }
  catch (error) { grantProbe = { error: error instanceof Error ? error.message : String(error), code: error?.code ?? null }; }
  const loaderAdmission = { commandRegistered: !!command, fiberState: entry.fiber?.state ?? null, importOutcome, grantProbe };
  ctx.loader.remove(entryId);
  await ctx.loader.await();
  assert.equal(ctx.commands.find(parent, 'review'), undefined);
  assert.equal(subscribers, 0);
  console.log('TUI_FIXTURE_RESULT=' + JSON.stringify({ command: false, progress, scene, admission: 'not-established', loaderAdmission, selfCheck: host.selfCheck() }));
} finally { await ctx.fiber.dispose(); }
