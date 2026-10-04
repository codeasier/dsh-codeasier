import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';

export const name = 'cross-review-public-profile-fixture';
export const inject = ['llm', 'agents', 'commands', 'approval', 'crossReview', 'tuiPluginHost', 'tuiScenes'];

/** A test-only native plugin, not a replacement engine or an admission helper. */
export async function apply(ctx, config) {
  assert.equal(resolve(config.repo), config.repo);
  assert.equal(resolve(config.witness), config.witness);
  assert.equal(resolve(config.control), config.control);
  assert.equal(dirname(config.witness), dirname(config.control));
  const service = ctx.crossReview;
  const requireCommand = config.requireCommand ?? true;
  assert.equal(typeof requireCommand, 'boolean');
  const parentRequest = `Run the explicitly approved no-network fixture review. Parent-only history sentinel: ${config.token}`;
  let commandAvailable;
  let nativeControlState = 'idle';
  let nativeVerification = Promise.resolve();
  const boundChildren = new Set();
  let owner;
  let plan;
  let completed;
  let ready = false;
  let approved = 0;
  let reportObserved = false;
  let staleObserved = false;
  let writeChain = Promise.resolve();
  const calls = [];
  const witness = (data) => writeChain = writeChain.then(() => appendFile(config.witness, JSON.stringify({ token: config.token, ...data }) + '\n'));
  const fail = (error) => witness({ stage: 'failure', message: error instanceof Error ? error.message : String(error) });
  const stops = [];
  let adapterDiagnostic;
  // Capture public scene state/subscription in this fixture's own activation.
  // Native child/Agent event chains must not borrow a caller-bound TUI accessor.
  const initialSceneId = ctx.tuiScenes.active?.id ?? null;
  let sceneTransitions = 0;
  stops.push(ctx.tuiScenes.subscribe(() => { sceneTransitions++; }));
  const supportedSceneId = () => { assert.equal(sceneTransitions, 0, 'Native controls must not open any scene'); return initialSceneId; };
  stops.push(ctx.on('cross-review/tui-capabilities', diagnostic => {
    adapterDiagnostic = diagnostic;
    void witness({ stage: 'adapter-registration', ...diagnostic });
  }));
  const loader = ctx.get('loader', false);
  const toolModule = await loader.import('@deepseek-ai/dsh-tools');
  const loopModule = await loader.import('@deepseek-ai/dsh-agent-loop');
  await witness({ stage: 'runtime-cohort', toolUrl: import.meta.resolve('@deepseek-ai/dsh-tools'), loopUrl: import.meta.resolve('@deepseek-ai/dsh-agent-loop'),
    toolInstanceMatches: ctx.get('tools', false) instanceof toolModule.default,
    loopInstanceMatches: ctx.get('agentLoop', false) instanceof loopModule.default,
    profile: ctx.get('profileContext', false)?.name });
  const checkReady = async () => {
    if (!completed || ready) return;
    const ids = completed.attempts.flatMap(attempt => [attempt.childId, attempt.controllerId]).filter(Boolean);
    if (ids.some(id => ctx.agents.get(SessionId(id)))) return;
    ready = true;
    const loader = ctx.get('loader', false);
    const configuredEntries = [...loader.entries()].filter(entry => entry.options.name.includes('dsh-codeasier')).map(entry => ({ id: entry.options.id, name: entry.options.name, state: entry.fiber?.state ?? null, uid: entry.fiber?.uid ?? null }));
    const adapterEntry = [...loader.entries()].find(entry => entry.options.name === 'dsh-codeasier/tui' || entry.options.name.endsWith('/dist/tui.js'));
    const commandPresent = !!ctx.commands.find(owner, 'review');
    void witness({ stage: 'admission-readiness', commandPresent, adapterDiagnostic, configuredEntries, adapterFiberState: adapterEntry?.fiber?.state ?? null, descriptor: ctx.tuiPluginHost.hostDescriptor() });
    assert.ok(adapterDiagnostic, 'The adapter must publish its own activation diagnostic');
    assert.equal(adapterDiagnostic.activationUid, adapterEntry?.fiber?.uid);
    commandAvailable = commandPresent;
    if (!commandPresent) {
      if (requireCommand) { void fail(new Error(`Real profile has no mediated review command: ${JSON.stringify(adapterDiagnostic)}`)); return; }
      assert.equal(adapterDiagnostic.capabilities.command, false);
      assert.ok(adapterDiagnostic.capabilities.issues.some(issue => /no verified.*Component identity/i.test(issue)),
        'Supported mode requires the adapter diagnostic to identify unadmitted Component identity, not another refusal');
      assert.equal(supportedSceneId(), null, 'No mediated report scene may open without command admission');
      await witness({ stage: 'supported-command-unavailable', commandAvailable: false, adapterDiagnostic, sceneId: supportedSceneId() });
    } else assert.equal(adapterDiagnostic.capabilities.command, true);
    assert.equal(completed.attempts.length, 2);
    assert.equal(boundChildren.size, 2);
    assert.ok(completed.attempts.every(attempt => attempt.state === 'completed' && attempt.snapshotId === plan.snapshot.id && boundChildren.has(attempt.childId)));
    void witness({ stage: 'ready', commandAvailable, requireCommand, runId: completed.id, revision: completed.revision, snapshotId: completed.snapshot.id,
      ownerSessionId: owner.session.id, childIds: completed.attempts.map(attempt => attempt.childId), controllerIds: completed.attempts.map(attempt => attempt.controllerId) });
  };
  class FixtureAdapter extends LlmAdapter {
    providerInfo(id) { return { id, name: 'Isolated TUI fixture: NO NETWORK' }; }
    async listModels(provider) { return ['fixture-parent', 'fixture-reviewer'].map(id => ({ provider, id, name: id })); }
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream(options) {
      void witness({ stage: 'model-call', provider: options.provider, model: options.model, purpose: options.purpose ?? null, toolNames: options.tools?.map(tool => tool.name) ?? [] });
      assert.equal(options.provider, 'fixture-only');
      assert.equal(options.purpose, undefined, 'auxiliary model calls must not be composed');
      assert.ok(calls.length < (requireCommand ? 6 : 10), 'unexpected fixture request budget exceeded');
      calls.push({ provider: options.provider, model: options.model, sessionId: options.sessionId, purpose: options.purpose ?? null });
      let requested;
      if (options.model === 'fixture-parent') {
        assert.ok(plan);
        assert.equal(options.sessionId, owner.session.id);
        await nativeVerification;
        const count = calls.filter(call => call.model === 'fixture-parent').length;
        if (count === 1) requested = [{ name: 'cross_review_start', args: { planId: plan.id } }];
        else if (nativeControlState === 'report') requested = [{ name: 'cross_review_report', args: { runId: completed.id } }];
        else if (['stale', 'cleanup'].includes(nativeControlState)) requested = [{ name: 'cross_review_control', args: {
          runId: completed.id, expectedRevision: completed.revision - (nativeControlState === 'stale' ? 1 : 0), action: 'cleanup',
        } }];
        else requested = [];
        for (const call of requested) assert.ok(options.tools.some(tool => tool.name === call.name), `Public owning-Agent tool ${call.name} must be presented`);
      } else {
        assert.equal(options.model, 'fixture-reviewer');
        assert.ok(completed === undefined, 'paid reviewer replay after terminal state is forbidden');
        assert.ok(options.tools.some(tool => tool.name === 'structured_output'));
        assert.ok(options.tools.every(tool => ['evidence_read', 'evidence_list', 'evidence_diff', 'evidence_notes', 'structured_output'].includes(tool.name)));
        const run = (await service.list(owner)).find(record => record.snapshot.id === plan.snapshot.id);
        assert.ok(run);
        const attempt = run.attempts.find(attempt => attempt.childId === options.sessionId);
        const child = ctx.agents.get(SessionId(options.sessionId));
        assert.ok(attempt && child, 'The durable child/evidence binding must precede its first model execution');
        assert.equal(attempt.snapshotId, plan.snapshot.id);
        assert.equal(child.session.header.parentSession, attempt.controllerId);
        assert.notEqual(child.session.id, owner.session.id);
        assert.equal(boundChildren.has(child.session.id), false, 'Each fresh reviewer executes exactly once');
        assert.equal(JSON.stringify(options.messages).includes(parentRequest), false, 'Fresh reviewer must not inherit owning-Agent history');
        assert.equal(options.messages.some(message => message.role === 'assistant'), false);
        await assert.rejects(service.report(child, run.id), /Run control ownership mismatch/);
        boundChildren.add(child.session.id);
        await witness({ stage: 'native-bound-child', childId: child.session.id, controllerId: attempt.controllerId,
          snapshotId: attempt.snapshotId, fresh: true, ownerReportRejected: true, ownershipCheckRoute: 'native-shared-service' });
        requested = [{ name: 'structured_output', args: { findings: [] } }];
      }
      for (const [index, call] of requested.entries()) {
        const block = { type: 'tool-call', id: ToolCallId(`tui-profile-${calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
        yield { type: 'block-end', index, block };
      }
      yield { type: 'finish', reason: requested.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
    }
  }
  stops.push(ctx.llm.registerAdapter(['fixture-only'], new FixtureAdapter()));
  const assertNoRealProviders = () => assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id), ['fixture-only']);
  assertNoRealProviders();
  stops.push(ctx.on('agent/error', ({ agent, error }) => {
    if (agent === owner) void fail(new Error(`Native owning Agent errored: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
    return undefined;
  }));
  stops.push(ctx.on('tools/result', (exec, result) => {
    if (exec.agent !== owner) return undefined;
    if (exec.name === 'cross_review_start') {
      if (result.isError) void fail(new Error(`Native startup rejected: ${result.error.message}`));
      else void witness({ stage: 'native-start-receipt', receipt: result.value });
    } else if (commandAvailable === false && ['cross_review_report', 'cross_review_control'].includes(exec.name)) {
      // Real public tools execute in the owning Agent's scripted followup turn.
      // Serialize checks before its next model step, not a fake mediated TUI command.
      nativeVerification = nativeVerification.then(async () => {
        assert.equal(supportedSceneId(), null);
        if (nativeControlState === 'stale') {
          assert.equal(exec.name, 'cross_review_control');
          assert.equal(result.isError, true);
          assert.match(result.error.message, /Stale run revision/);
          const current = await service.status(owner, completed.id);
          assert.deepEqual(current, completed, 'Rejected stale controls must not mutate any durable run or snapshot field');
          assert.deepEqual(await service.report(owner, completed.id), nativeReport);
          staleObserved = true;
          nativeControlState = 'cleanup';
          await witness({ stage: 'stale-rejected', route: 'native-owning-agent-tools', toolName: exec.name,
            runId: completed.id, revision: current.revision, unchanged: true });
          return;
        }
        assert.equal(result.isError, false, result.isError ? result.error.message : '');
        assert.equal(typeof result.value, 'string');
        const receipt = JSON.parse(result.value);
        if (nativeControlState === 'report') {
          assert.equal(exec.name, 'cross_review_report');
          assert.equal(receipt.runId, completed.id);
          assert.equal(receipt.revision, completed.revision);
          assert.equal(receipt.complete, true);
          assert.equal(receipt.state, 'completed');
          assert.equal(receipt.snapshotId, plan.snapshot.id);
          assert.equal(receipt.reviewerCompleted, 2);
          assert.equal(receipt.reviewerRequired, 2);
          assert.deepEqual(receipt.findings, []);
          assert.deepEqual(receipt.pending, []);
          nativeReport = receipt;
          reportObserved = true;
          nativeControlState = 'stale';
          await witness({ stage: 'report', route: 'native-owning-agent-tools', toolName: exec.name,
            report: receipt, sceneId: null, ownerSessionId: owner.session.id });
        } else {
          assert.equal(nativeControlState, 'cleanup');
          assert.equal(exec.name, 'cross_review_control');
          assert.ok(reportObserved && staleObserved);
          assert.equal(receipt.removed, completed.id);
          assert.deepEqual(await service.list(owner), []);
          await assert.rejects(service.status(owner, completed.id), /Run control ownership mismatch/);
          await assert.rejects(service.report(owner, completed.id), /Run control ownership mismatch/);
          assertNoRealProviders();
          assert.equal(approved, 1);
          assert.equal(calls.filter(call => call.model === 'fixture-reviewer').length, 2);
          assert.deepEqual(ctx.agents.list().map(agent => agent.session.id), [owner.session.id]);
          nativeControlState = 'done';
          await witness({ stage: 'native-cleanup', route: 'native-owning-agent-tools', toolName: exec.name,
            removed: receipt.removed, snapshotId: plan.snapshot.id, runRemoved: true, snapshotRemoved: true });
        }
      });
      void nativeVerification.catch(fail);
    }
    return undefined;
  }));
  let nativeReport;
  stops.push(ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (agent !== owner || nativeControlState !== 'done') return;
    await nativeVerification;
    nativeControlState = 'drained';
    await witness({ stage: 'complete', route: 'native-owning-agent-tools', commandAvailable: false,
      runId: completed.id, revision: completed.revision, snapshotId: plan.snapshot.id, approvals: approved, calls,
      childIds: completed.attempts.map(attempt => attempt.childId), controllerIds: completed.attempts.map(attempt => attempt.controllerId),
      remainingAgentIds: ctx.agents.list().map(agent => agent.session.id), sceneId: commandAvailable ? ctx.tuiScenes.active?.id ?? null : supportedSceneId(),
      providerIds: ctx.llm.listProviders().map(provider => provider.id), generationId: ctx.tuiPluginHost.generationId,
      runRemoved: true, snapshotRemoved: true, nativeControlsDrained: true });
  }));
  stops.push(service.subscribe(record => {
    if (!owner || record.owner.sessionId !== owner.session.id) return;
    if (record.state === 'completed') { completed = record; void checkReady().catch(fail); }
    if (record.state === 'failed' || record.state === 'interrupted' || record.state === 'awaiting_timeout') void fail(new Error(`Review stopped: ${record.state}`));
  }));
  stops.push(ctx.on('agent/disposed', () => { void checkReady().catch(fail); return undefined; }));
  stops.push(ctx.on('agent/created', async ({ agent }) => {
    if (!ctx.agents.roots().includes(agent)) return undefined;
    await witness({ stage: 'root-agent-observed', cwd: agent.session.header.cwd, ownerSessionId: agent.session.id });
    assert.equal(agent.session.header.cwd, config.repo, 'TUI owner must use the explicit isolated repository');
    assert.equal(owner, undefined, 'only one owning TUI root Agent is expected');
    owner = agent;
    assertNoRealProviders();
    assert.equal(ctx.get('profileContext', false)?.name, config.profile);
    assert.equal(ctx.approval.overrideOf(agent.session) ?? ctx.approval.config.policy ?? 'ask', 'ask');
    plan = await service.preview(agent, { kind: 'local', root: config.repo });
    assert.equal(calls.length, 0, 'preview may not call any model');
    stops.push(agent.ctx.on('approval/request', async (request, next) => {
      if (request.agent !== agent || request.toolName !== 'cross_review_start' || !request.reason?.includes(plan.digest)) return next();
      approved++;
      assert.equal(approved, 1);
      return 'allowed-once';
    }, { prepend: true }));
    await witness({ stage: 'preview', digest: plan.digest, snapshotId: plan.snapshot.id, providerIds: ctx.llm.listProviders().map(provider => provider.id) });
    agent.followup(createUserMessage({ content: [{ type: 'text', text: parentRequest }], source: { kind: 'user' } }));
    return undefined;
  }));
  stops.push(ctx.on('session/event', (session, event) => {
    if (!owner || session.id !== owner.session.id || event.type !== 'command/done') return;
    void (async () => {
      const data = event.data;
      if (data.kind === 'error') {
        assert.ok(completed && reportObserved);
        assert.match(data.text, /Stale run revision/);
        const current = await service.status(owner, completed.id);
        assert.equal(current.revision, completed.revision);
        staleObserved = true;
        await witness({ stage: 'stale-rejected', runId: completed.id, revision: current.revision });
        return;
      }
      const result = JSON.parse(data.text ?? '{}');
      if (result.runId && Array.isArray(result.findings)) {
        assert.equal(result.runId, completed.id);
        assert.equal(result.complete, true);
        assert.equal(result.snapshotId, plan.snapshot.id);
        assert.equal(ctx.tuiScenes.active?.id, 'cross-review-report', 'the real mediated adapter must select and open its report scene');
        reportObserved = true;
        await witness({ stage: 'report', report: result, sceneId: ctx.tuiScenes.active.id, ownerSessionId: owner.session.id });
      } else if (result.removed) {
        assert.ok(reportObserved && staleObserved);
        assert.equal(result.removed, completed.id);
        assert.deepEqual(await service.list(owner), []);
        assertNoRealProviders();
        assert.equal(approved, 1);
        assert.equal(calls.filter(call => call.model === 'fixture-reviewer').length, 2);
        assert.deepEqual(ctx.agents.list().map(agent => agent.session.id), [owner.session.id]);
        await witness({ stage: 'complete', runId: completed.id, revision: completed.revision, approvals: approved, calls,
          childIds: completed.attempts.map(attempt => attempt.childId), controllerIds: completed.attempts.map(attempt => attempt.controllerId),
          remainingAgentIds: ctx.agents.list().map(agent => agent.session.id), sceneId: commandAvailable ? ctx.tuiScenes.active?.id ?? null : supportedSceneId(),
          providerIds: ctx.llm.listProviders().map(provider => provider.id), generationId: ctx.tuiPluginHost.generationId });
      }
    })().catch(fail);
  }));
  const controlWatcher = watch(dirname(config.control), (_event, filename) => {
    if (String(filename) !== config.control.split('/').at(-1)) return;
    void (async () => {
      let action;
      try { action = JSON.parse(await readFile(config.control, 'utf8')); } catch { return; }
      assert.equal(action.token, config.token);
      if (action.action === 'close-scene') {
        assert.ok(reportObserved);
        ctx.tuiScenes.close();
        await witness({ stage: 'scene-closed' });
      } else if (action.action === 'native-controls') {
        assert.equal(requireCommand, false);
        assert.equal(commandAvailable, false);
        assert.ok(ready && completed);
        // Directory watchers may notify more than once for one control-file write.
        if (nativeControlState !== 'idle') return;
        assert.equal(supportedSceneId(), null);
        nativeControlState = 'report';
        await witness({ stage: 'native-controls-started', route: 'native-owning-agent-tools', ownerSessionId: owner.session.id });
        owner.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the completed native report, reject a stale cleanup, then clean its terminal aggregate using public native tools.' }], source: { kind: 'user' } }));
      } else throw new Error(`Unknown profile supervisor action: ${action.action}`);
    })().catch(fail);
  });
  stops.push(() => controlWatcher.close());
  stops.push(ctx.provide('crossReviewFixture', true));
  void witness({ stage: 'fixture-mounted', providerIds: ctx.llm.listProviders().map(provider => provider.id) });
  return async () => {
    for (const stop of stops.reverse()) stop();
    await witness({ stage: 'fixture-disposed', providerIds: ctx.llm.listProviders().map(provider => provider.id),
      nativeControlState, watcherClosed: true });
    await writeChain;
  };
}
