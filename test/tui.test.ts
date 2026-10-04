import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { CommandId, type CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { TuiStatusViewDescriptor, TuiStatusViewProps } from '@deepseek-harness-tui/dsh-tui/extensions';
import type { TuiSceneDescriptor, TuiSceneProps } from '@deepseek-harness-tui/dsh-tui/scenes';
import type { CrossReviewService } from '../src/service.js';
import type { RunRecord, ReviewReport } from '../src/records.js';
import { apply, mountTuiAdapter, TUI_COMMAND_ID, TUI_SCENE_ID, TUI_STATUS_KEY, TUI_ADAPTER_DIAGNOSTIC, type TuiAdapterDiagnostic } from '../src/tui.js';

const runId = '00000000-0000-4000-8000-000000000001';
const foreignId = '00000000-0000-4000-8000-000000000002';
const report: ReviewReport = { runId, revision: 3, state: 'awaiting_judge', complete: false, snapshotId: 'bound-snapshot', findings: [], pending: [], rejected: [], reviewerCompleted: 1, reviewerRequired: 1, audit: [] };

/** Deliberately mocked capability boundary, NOT a forged native/TUI admission. */
function boundary(options: { richRefused?: boolean; sceneRefused?: boolean; commandDenied?: boolean; noContract?: boolean; registrationRefused?: boolean; noStatus?: boolean; noScenes?: boolean; noHost?: boolean } = {}) {
  const owner = { session: { id: 'unit-owner' } } as unknown as Agent;
  const listeners = new Set<(record: RunRecord) => void>();
  const calls = { subscriptions: 0, unsubscriptions: 0, reports: 0, cancels: [] as { owner: Agent; runId: string; expectedRevision: number }[], scalar: [] as string[], scalarDisposed: 0,
    viewDisposed: 0, sceneDisposed: 0, commandDisposed: 0, registered: 0, opened: [] as string[] };
  let view: TuiStatusViewDescriptor | undefined; let scene: TuiSceneDescriptor | undefined; let command: CommandDefinition | undefined;
  const service = {
    subscribe(listener: (record: RunRecord) => void) { calls.subscriptions++; listeners.add(listener); return () => { calls.unsubscriptions++; listeners.delete(listener); }; },
    async report(agent: Agent, id: string) { assert.equal(agent, owner); assert.equal(id, runId); calls.reports++; return report; },
    async cancel(agent: Agent, control: { runId: string; expectedRevision: number }) { assert.equal(agent, owner); calls.cancels.push({ owner: agent, ...control }); return { id: control.runId, revision: control.expectedRevision + 1, state: 'cancelled' }; },
    start() { assert.fail('rendering must never schedule startup'); },
    preview() { assert.fail('rendering must never prepare evidence'); },
    status() { assert.fail('rendering must never poll status'); },
    list() { assert.fail('rendering must never enumerate other owners'); },
    dispose() { assert.fail('adapter unload must not dispose the shared backend'); },
  } as unknown as CrossReviewService;
  const status = {
    registerView(descriptor: TuiStatusViewDescriptor, identity: Context) { assert.equal(identity, ctx); view = descriptor; return options.richRefused ? undefined : () => { calls.viewDisposed++; }; },
    set(key: string, text: string, identity: Context) { assert.equal(key, TUI_STATUS_KEY); assert.equal(identity, ctx); calls.scalar.push(text); return () => { calls.scalarDisposed++; }; },
  };
  const scenes = {
    register(descriptor: TuiSceneDescriptor, identity: Context) { assert.equal(identity, ctx); if (options.sceneRefused) throw new Error('scene refused'); scene = descriptor; return () => { calls.sceneDisposed++; }; },
    open(id: string) { calls.opened.push(id); return true; },
  };
  const host = {
    hostDescriptor() { return { contracts: options.noContract ? [] : [{ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' }] }; },
    grants: { allows(identity: Context, permission: string, scope: string) { assert.equal(identity, ctx); assert.equal(permission, 'commands.invoke'); assert.equal(scope, TUI_COMMAND_ID); return !options.commandDenied; } },
    registerCommand(identity: Context, id: string, definition: CommandDefinition) { assert.equal(identity, ctx); assert.equal(id, TUI_COMMAND_ID); calls.registered++;
      if (options.registrationRefused) throw new Error('COMPONENT_NOT_ADMITTED'); command = definition; return () => { calls.commandDisposed++; }; },
  };
  const services: Record<string, unknown> = { crossReview: service, tuiPluginHost: options.noHost ? undefined : host, tuiStatus: options.noStatus ? undefined : status, tuiScenes: options.noScenes ? undefined : scenes };
  const ctx = { get(key: string) { assert.notEqual(key, 'commands', 'adapter must never directly register a fallback command'); return services[key]; } } as unknown as Context;
  const emit = (id: string, revision: number, state: RunRecord['state'] = 'running') => {
    const record = { id, revision, state, attempts: [{ kind: 'reviewer', state: 'completed' }], config: { reviewers: [{}] } } as unknown as RunRecord;
    for (const listener of listeners) listener(record);
  };
  const invoke = async (rawInput: string) => { assert.ok(command); return command.handler({ commandId: CommandId('unit-command'), agent: owner, rawInput, signal: new AbortController().signal, attachments: [] }); };
  // Fake rendering is only a unit contract for INJECTED props, not React runtime.
  const injected = {
    React: { useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(), createElement: (element: unknown, props: unknown, ...children: unknown[]) => ({ element, props, children }) },
    ui: { Text: 'Text', Box: 'Box', ScrollBox: 'ScrollBox' }, close() {},
  };
  const progress = () => { assert.ok(view); return JSON.stringify((view.component as (props: TuiStatusViewProps) => unknown)(injected as unknown as TuiStatusViewProps)); };
  const renderedReport = () => { assert.ok(scene); return JSON.stringify((scene.component as (props: TuiSceneProps) => unknown)(injected as unknown as TuiSceneProps)); };
  return { ctx, service, calls, listeners, emit, invoke, progress, renderedReport, get command() { return command; }, get view() { return view; }, get scene() { return scene; } };
}

test('plain Host without optional services remains a no-op with no service subscription', async () => {
  const requested: string[] = [];
  const ctx = { get(key: string) { requested.push(key); return undefined; } } as unknown as Context;
  const handle = mountTuiAdapter(ctx);
  assert.deepEqual(handle.capabilities, { command: false, progress: 'none', scene: false, issues: [] });
  handle.dispose(); handle.dispose();
  assert.equal(requested.includes('crossReview'), false);
  const stop = await apply(ctx); stop(); stop();
});

test('unit boundary: public rich view, scene, and SAME shared command use injected rendering only', async () => {
  const f = boundary(); const handle = mountTuiAdapter(f.ctx);
  assert.deepEqual(handle.capabilities, { command: true, progress: 'view', scene: true, issues: [] });
  assert.equal(f.command?.name, 'review'); assert.equal(f.view?.key, TUI_STATUS_KEY); assert.equal(f.scene?.id, TUI_SCENE_ID);
  assert.equal(f.calls.subscriptions, 1);
  const initial = f.progress(); f.emit(foreignId, 100); assert.equal(f.progress(), initial, 'unselected owner records must not appear');
  const result = await f.invoke(`report ${runId}`); assert.equal(result.kind, 'success');
  assert.equal(f.calls.reports, 1); assert.deepEqual(f.calls.opened, [TUI_SCENE_ID]);
  assert.ok(f.progress().includes(runId)); assert.ok(f.renderedReport().includes('bound-snapshot'));
  f.emit(foreignId, 101); assert.equal(f.progress().includes(foreignId), false);
  f.emit(runId, 4); assert.ok(f.progress().includes('revision 4'));
  assert.ok(f.renderedReport().includes('immutable; refresh'));
  assert.ok(f.renderedReport().includes('bound-snapshot'));
  assert.equal(f.calls.reports, 1, 'service events must not drive polling or scheduling');
  handle.dispose(); handle.dispose();
  assert.equal(f.listeners.size, 0); assert.equal(f.calls.unsubscriptions, 1);
  assert.equal(f.calls.commandDisposed, 1); assert.equal(f.calls.viewDisposed, 1); assert.equal(f.calls.sceneDisposed, 1);
});

test('unit boundary: revision controls pass the exact invocation owner through the shared command', async () => {
  const f = boundary(); const handle = mountTuiAdapter(f.ctx);
  const result = await f.invoke(`cancel ${runId} 3`); assert.equal(result.kind, 'success');
  assert.deepEqual(f.calls.cancels.map(({ owner, ...control }) => control), [{ runId, expectedRevision: 3 }]);
  const bad = await f.invoke(`cancel ${runId} NaN`); assert.equal(bad.kind, 'error');
  assert.equal(f.calls.cancels.length, 1);
  handle.dispose();
});

test('unit boundary: rich refusal uses scalar status and unload disposes only owned effects', async () => {
  const f = boundary({ richRefused: true, sceneRefused: true }); const handle = mountTuiAdapter(f.ctx);
  assert.equal(handle.capabilities.progress, 'text'); assert.equal(handle.capabilities.scene, false);
  assert.equal(handle.capabilities.command, true);
  await f.invoke(`report ${runId}`); f.emit(runId, 4);
  assert.ok(f.calls.scalar.at(-1)?.includes('revision 4'));
  assert.deepEqual(f.calls.opened, []);
  handle.dispose(); handle.dispose();
  assert.equal(f.calls.scalarDisposed, f.calls.scalar.length);
  assert.equal(f.calls.unsubscriptions, 1); assert.equal(f.calls.commandDisposed, 1);
});

test('unit boundary: missing contract, denied grant, or unadmitted registration never falls back directly', () => {
  for (const options of [{ noContract: true }, { commandDenied: true }, { registrationRefused: true }]) {
    const f = boundary(options); const handle = mountTuiAdapter(f.ctx);
    assert.equal(handle.capabilities.command, false); assert.equal(f.command, undefined);
    assert.ok(handle.capabilities.issues.length > 0);
    assert.match(f.progress(), /native cross_review_report\/control tools; \/review unavailable/);
    assert.equal(f.progress().includes('/review report'), false);
    assert.match(f.renderedReport(), /owning Agent.*native cross_review_report\/control tools/);
    assert.equal(f.calls.registered, options.registrationRefused ? 1 : 0);
    handle.dispose();
  }
});

test('own activation diagnostic preserves refusal evidence and cannot affect registration or disposal', async () => {
  const f = boundary({ registrationRefused: true });
  let observed: TuiAdapterDiagnostic | undefined;
  Object.assign(f.ctx, { fiber: { uid: 88 }, emit(name: string, diagnostic: TuiAdapterDiagnostic) {
    assert.equal(name, TUI_ADAPTER_DIAGNOSTIC); observed = diagnostic;
    assert.ok(Object.isFrozen(diagnostic)); assert.ok(Object.isFrozen(diagnostic.capabilities.issues));
    throw new Error('Untrusted diagnostic observer');
  } });
  const stop = await apply(f.ctx);
  assert.equal(observed?.activationUid, 88); assert.equal(observed?.capabilities.command, false);
  assert.match(observed!.capabilities.issues.join('\n'), /COMPONENT_NOT_ADMITTED/);
  assert.equal(f.calls.registered, 1); stop(); stop();
  assert.equal(f.calls.viewDisposed, 1); assert.equal(f.calls.sceneDisposed, 1); assert.equal(f.calls.unsubscriptions, 1);
});

test('unit boundary: command-only host requires no rendering subscription and survives missing UI seams', async () => {
  const f = boundary({ noStatus: true, noScenes: true }); const handle = mountTuiAdapter(f.ctx);
  assert.equal(handle.capabilities.command, true); assert.equal(handle.capabilities.progress, 'none'); assert.equal(handle.capabilities.scene, false);
  const result = await f.invoke(`report ${runId}`); assert.equal(result.kind, 'success');
  assert.equal(f.calls.subscriptions, 0); assert.deepEqual(f.calls.opened, []); handle.dispose();
});

test('adapter source has no runtime React or public TUI imports', async () => {
  const source = await readFile(new URL('../src/plugins/cross-review/tui.ts', import.meta.url), 'utf8');
  assert.equal(/from ['"]react(?:\/[^'"]*)?['"]/.test(source), false);
  for (const statement of source.matchAll(/import\s+[^;]+;/g)) {
    if (statement[0].includes('@deepseek-harness-tui/dsh-tui')) assert.ok(statement[0].startsWith('import type '));
  }
});

test('optional manifest parses through the public standard parser and gates only its declared command', async () => {
  const resolver = createRequire(import.meta.url);
  const tuiPackage = resolver.resolve('@deepseek-harness-tui/dsh-tui/package.json');
  const standardEntry = createRequire(tuiPackage).resolve('@dsh-std/manifest');
  const standard = await import(pathToFileURL(standardEntry).href);
  const source = await readFile(new URL('../dsh-plugin.json', import.meta.url), 'utf8');
  const manifest = standard.parseManifest(source, { source: 'dsh-plugin.json' });
  assert.equal(manifest.id, 'dsh-codeasier.tui');
  assert.equal(manifest.facets.host.entry, './dist/tui.js');
  assert.equal(manifest.facets.host.apiVersion, 'v1alpha1');
  assert.deepEqual(manifest.requires.contracts, [{ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' }]);
  assert.deepEqual(manifest.permissions.map((permission: { name: string; scope: string }) => ({ name: permission.name, scope: permission.scope })), [{ name: 'commands.invoke', scope: TUI_COMMAND_ID }]);
  assert.equal(manifest.contributes.commands[0].id, TUI_COMMAND_ID);
  assert.equal(manifest.contributes.commands.length, 1);
  assert.deepEqual(manifest.subscriptions, []);
  assert.ok(Object.isFrozen(manifest));
  assert.equal(standard.projectManifest(manifest).metadata.name, manifest.id);
});

test('real public TUI services mount in isolated HOME; unadmitted command remains fail-closed', { timeout: 25_000 }, async t => {
  const temporaryRoot = await realpath(tmpdir());
  const home = await realpath(await mkdtemp(join(temporaryRoot, 'dsh-tui-adapter-')));
  t.after(async () => {
    assert.equal(resolve(home), home); assert.equal(dirname(home), temporaryRoot); assert.ok(basename(home).startsWith('dsh-tui-adapter-')); assert.equal(await realpath(home), home);
    await rm(home, { recursive: true, force: true });
  });
  // No root TUI/profile/working-activity activation. Only public seam modules.
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('DSH_')) delete environment[key];
  Object.assign(environment, { HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh') });
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./helpers/tui-profile-public-seams.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: environment, timeout: 20_000, maxBuffer: 1024 * 1024,
  });
  const line = stdout.split('\n').find(value => value.startsWith('TUI_FIXTURE_RESULT='));
  assert.ok(line);
  const result = JSON.parse(line.slice('TUI_FIXTURE_RESULT='.length)) as { command: boolean; progress: string; scene: boolean; admission: string; selfCheck: string[]; loaderAdmission: { commandRegistered: boolean; fiberState: number | null } };
  assert.equal(result.command, false); assert.equal(result.admission, 'not-established');
  assert.equal(result.progress, 'view', 'real public rich progress must register without private helpers');
  assert.equal(result.scene, true, 'real public scene must register without private helpers');
  t.diagnostic(`Actual public status/scene mounting verified. Official native Loader admission probe: ${JSON.stringify(result.loaderAdmission)}. No private identity helpers used; this observer-only smoke fixture is not full native review acceptance.`);
});
