import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { watch } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { executeIsolated } from './helpers/isolated-execute.js';

const enabled = process.env.DSH_CODEASIER_TUI_PROFILE_TEST === '1';
// The positive mediated-command acceptance gate remains the default. Only an
// explicit zero selects the currently supported public native-tools capability.
const requireCommand = process.env.DSH_CODEASIER_PROFILE_REQUIRE_COMMAND !== '0';
const artifact = process.env.DSH_CODEASIER_TEST_ARTIFACT ?? fileURLToPath(new URL('../.dsh-codeasier/package-acceptance/dsh-codeasier-0.0.0.tgz', import.meta.url));
async function publicCli(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (environment.DSH_CODEASIER_TEST_CLI) {
    assert.ok(isAbsolute(environment.DSH_CODEASIER_TEST_CLI), 'The explicit public CLI path must be absolute');
    return realpath(environment.DSH_CODEASIER_TEST_CLI);
  }
  for (const directory of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      const candidate = await realpath(join(directory, 'dsh'));
      // pnpm prepends a POSIX shell shim to PATH. This fixture deliberately
      // executes the public JavaScript CLI with the verified Node runtime.
      const header = (await readFile(candidate, 'utf8')).split('\n', 1)[0]!;
      if (/^#!.*\bnode\b/.test(header) || /\.(?:mjs|cjs|js)$/.test(candidate)) return candidate;
    } catch { /* continue public PATH discovery */ }
  }
  throw new Error('A public dsh CLI is required; provide DSH_CODEASIER_TEST_CLI');
}
const execute = promisify(execFile);
type Witness = { stage: string; token: string; [key: string]: unknown };

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DSH_|NPM_CONFIG_|npm_config_|PNPM_|GIT_)/.test(key) || /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    NPM_CONFIG_USERCONFIG: join(home, 'empty.npmrc'), NPM_CONFIG_GLOBALCONFIG: join(home, 'empty.npmrc'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_TELEMETRY_MODE: 'DISABLED', DSH_TUI_LANG: 'en' };
}
function stripAnsi(value: string): string { return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, ''); }
function containsRendered(value: string, phrase: string): boolean { return stripAnsi(value).replace(/\s+/g, '').includes(phrase.replace(/\s+/g, '')); }

test('public CLI discovery skips pnpm shell shims before a JavaScript entry', async t => {
  const parent = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(parent, 'dsh-cli-discovery-')));
  t.after(async () => {
    assert.equal(resolve(directory), directory); assert.equal(dirname(directory), parent);
    assert.ok(basename(directory).startsWith('dsh-cli-discovery-')); assert.equal(await realpath(directory), directory);
    await rm(directory, { recursive: true, force: true });
  });
  const shim = join(directory, 'shim'), script = join(directory, 'script');
  await Promise.all([mkdir(shim), mkdir(script)]);
  await writeFile(join(shim, 'dsh'), '#!/bin/sh\nexit 1\n');
  await writeFile(join(script, 'dsh'), '#!/usr/bin/env node\n');
  assert.equal(await publicCli({ PATH: `${shim}${delimiter}${script}` }), join(script, 'dsh'));
  await assert.rejects(publicCli({ DSH_CODEASIER_TEST_CLI: 'relative-cli' }), /must be absolute/);
});

/** Separately opted-in: installs only into a verified, newly created temporary home. */
test(requireCommand
  ? 'real disposable TUI profile admits adapter and uses the native shared report/revision controls'
  : 'real disposable profile verifies supported native report/revision controls with unavailable mediated command', { skip: !enabled, timeout: 360_000 }, async t => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'This isolated profile fixture requires Node 22 or newer');
  const cli = await publicCli();
  assert.ok(isAbsolute(artifact));
  await realpath(artifact);
  const temporaryRoot = await realpath(tmpdir());
  const home = await realpath(await mkdtemp(join(temporaryRoot, 'dsh-real-tui-profile-')));
  const repo = join(home, 'repo'); const fixturePackage = join(home, 'fixture-package'); const witnesses = join(home, 'witnesses');
  await Promise.all([mkdir(repo), mkdir(fixturePackage), mkdir(witnesses)]);
  const profile = `tui-test-${randomUUID().replaceAll('-', '')}`;
  const token = randomUUID();
  const witnessPath = join(witnesses, 'events.jsonl'); const controlPath = join(witnesses, 'control.json');
  const env = isolatedEnvironment(home);
  await Promise.all([writeFile(join(home, 'empty.npmrc'), ''), writeFile(witnessPath, '')]);
  let bridge: ChildProcessWithoutNullStreams | undefined;
  let bridgeEnded = false;
  let output = ''; let supervisorOutput = ''; let phase = 'setup'; let proofComplete = false;
  let closeBridge: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;
  const events: Witness[] = [];
  const eventWaiters = new Set<{ predicate: (event: Witness) => boolean; resolve: (event: Witness) => void; reject: (error: Error) => void }>();
  const outputWaiters = new Set<{ phrase: string; resolve: () => void; reject: (error: Error) => void }>();
  t.after(async () => {
    if (!proofComplete) {
      t.diagnostic(`Profile stopped in phase ${phase}; witness stages ${events.map(event => event.stage).join(', ')}\n${stripAnsi(output).slice(-8000)}\n${supervisorOutput}`);
      t.diagnostic(JSON.stringify(events.filter(event => ['runtime-cohort', 'adapter-registration', 'admission-readiness', 'model-call', 'failure'].includes(event.stage)).map(({ token: _nonce, ...event }) => event)));
    }
    watcher?.close();
    if (bridge && !bridgeEnded) {
      bridge.stdin.write(JSON.stringify({ action: 'terminate' }) + '\n');
      await closeBridge;
    }
    assert.equal(resolve(home), home); assert.equal(dirname(home), temporaryRoot); assert.ok(basename(home).startsWith('dsh-real-tui-profile-')); assert.equal(await realpath(home), home);
    await rm(home, { recursive: true, force: true });
    await assert.rejects(realpath(home), { code: 'ENOENT' }, 'The disposable profile, sessions, store, and PTY fixture artifacts must be removed');
  });
  const version = await execute(process.execPath, [cli, '--version'], { cwd: repo, env, timeout: 10_000 });
  assert.equal(version.stdout.trim(), '0.2.0-rc.2', 'The exact public DSH runtime cohort must be verified');
  const gitEnvironment = { ...env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const args of [['init', '-q'], ['config', 'core.hooksPath', '/dev/null']]) await execute('git', args, { cwd: repo, env: gitEnvironment });
  await writeFile(join(repo, 'main.ts'), 'export const VALUE = 1;\n');
  await execute('git', ['add', '--', 'main.ts'], { cwd: repo, env: gitEnvironment });
  await execute('git', ['commit', '-qm', 'isolated no-paid-call TUI fixture'], { cwd: repo, env: gitEnvironment });
  await copyFile(new URL('./helpers/tui-profile-fixture.mjs', import.meta.url), join(fixturePackage, 'index.mjs'));
  await writeFile(join(fixturePackage, 'package.json'), JSON.stringify({ name: 'dsh-codeasier-tui-fixture', version: '0.0.0', private: true, type: 'module', main: './index.mjs', exports: { '.': './index.mjs' },
    peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2', '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2', '@deepseek-ai/dsh-session': '0.2.0-rc.2', '@deepseek-ai/dsh-tools': '0.2.0-rc.2', '@deepseek-ai/dsh-agent-loop': '0.2.0-rc.2' },
    peerDependenciesMeta: { '@deepseek-ai/dsh': { optional: true } },
    dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2));
  await writeFile(join(fixturePackage, 'cordis.patch.yml'), `- insert:\n    - id: cross-review-profile-fixture\n      name: dsh-codeasier-tui-fixture\n      config: ${JSON.stringify({ repo, witness: witnessPath, control: controlPath, token, profile, requireCommand })}\n`);
  // One public package-manager invocation avoids reifying malformed bundled
  // workspace:* manifests between sequential npm-style operations.
  phase = 'preparing isolated public profile manifest';
  const profileDir = join(home, '.dsh', 'profiles', profile);
  await mkdir(profileDir, { recursive: true });
  assert.ok((await realpath(profileDir)).startsWith(`${home}/`));
  const manifestPath = join(profileDir, 'package.json');
  // This is public profile configuration, not manifested Component admission.
  // Match the CLI's base bundle and pin the manager before its first lookup;
  // a fresh Corepack HOME otherwise resolves the moving pnpm latest tag.
  await writeFile(manifestPath, JSON.stringify({ name: `dsh-profile-${profile}`, private: true,
    packageManager: 'pnpm@11.21.0', dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2) + '\n');
  // Precreating the manifest skips CLI initProfile, so preserve its public
  // workspace layout too. Isolated linking can split native scope/scheduler
  // module identities between installation-backed and profile-backed plugins.
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nignoreScripts: true\n');
  // This includes a fresh Corepack download; use a network bound, not the
  // short runtime-query bound. Every failed setup still drains its process group.
  const manager = await executeIsolated('pnpm', ['--version'], { cwd: profileDir, env, timeout: 90_000 });
  assert.equal(manager.stdout.trim(), '11.21.0');
  t.diagnostic(`Disposable profile package manager: pnpm ${manager.stdout.trim()}`);
  phase = 'installing isolated packages';
  const install = await executeIsolated(process.execPath, [cli, 'plugin', '--profile', profile, 'add', '@deepseek-harness-tui/dsh-tui@0.12.0', '@deepseek-ai/dsh-agent-loop@0.2.0-rc.2', artifact, fixturePackage, '--ignore-scripts', '--store-dir', join(home, 'pnpm-store')], {
    cwd: repo, env, timeout: 150_000, maxBuffer: 8 * 1024 * 1024,
  });
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } }; dependencies?: Record<string, string> };
  assert.ok(manifest.dependencies?.['@deepseek-harness-tui/dsh-tui']);
  assert.ok(manifest.dependencies?.['dsh-codeasier']);
  t.diagnostic(`Disposable profile active bundles: ${JSON.stringify(manifest.dsh?.profile?.bundles)}`);
  assert.ok(manifest.dsh?.profile?.bundles?.includes('@deepseek-harness-tui/dsh-tui'));
  assert.ok(manifest.dsh?.profile?.bundles?.includes('dsh-codeasier-tui-fixture'));
  phase = 'composing isolated profile';
  const configuration = { root: join(home, 'review-store'), review: { reviewers: ['a', 'b'].map(id => ({ id, provider: 'fixture-only', model: 'fixture-reviewer', focus: 'correctness', maxTokens: 128 })),
    concurrency: 2, timeoutMs: 15_000, judge: { kind: 'parent' } }, preauthorizedDigests: [] };
  const disabled = ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'deepseek-account', 'authorization', 'credentials', 'session-title-llm', 'session-telemetry-otel', 'dsh-tui-auth', 'dsh-tui-webserver', 'working-activity'];
  const overlay = [
    ...disabled.map(id => `- id: ${id}\n  disabled: true`),
    `- id: cross-review\n  config: ${JSON.stringify(configuration)}`,
    '- id: approval\n  config: { policy: ask }',
    '- id: subagent\n  config: { maxDepth: 2, maxActiveSubagents: 8 }',
    '- id: agent-default-model\n  config: { provider: fixture-only, model: fixture-parent }',
    `- id: dsh-tui\n  inject: [workspaceRegistry, agents, tuiWorkspaces, tuiScenes, tuiDialogs, tuiStatus, tuiShortcuts, tuiRenderers, tuiThemes, crossReviewFixture]\n  config: ${JSON.stringify({ provider: 'fixture-only', model: 'fixture-parent', cwd: repo, fullscreen: true, activity: false, lang: 'en', whale: false, terminalImages: false })}`,
    '- insert:\n    - id: cross-review-optional-tui\n      name: dsh-codeasier/tui\n      inject: [crossReview, tuiPluginHost, tuiScenes, tuiStatus, crossReviewFixture]',
  ].join('\n') + '\n';
  await writeFile(join(profileDir, 'cordis.patch.yml'), overlay);
  const dump = await execute(process.execPath, [cli, '--profile', profile, '--dump-config'], { cwd: repo, env, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(dump.stdout.includes('fixture-only'));
  assert.ok(dump.stdout.includes('cross-review-profile-fixture'));
  const waiting = (predicate: (event: Witness) => boolean): Promise<Witness> => {
    const previousFailure = events.find(event => event.stage === 'failure');
    if (previousFailure) return Promise.reject(new Error(String(previousFailure.message)));
    const found = events.find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => { eventWaiters.delete(waiter); rejectEvent(new Error(`Missing profile witness in phase ${phase}; stages ${events.map(event => event.stage).join(', ')}\n${stripAnsi(output).slice(-8000)}`)); }, 30_000);
      const waiter = { predicate, resolve: (event: Witness) => { clearTimeout(timer); resolveEvent(event); }, reject: (error: Error) => { clearTimeout(timer); rejectEvent(error); } };
      eventWaiters.add(waiter);
    });
  };
  let processing = Promise.resolve(); let consumed = 0;
  const readWitnesses = () => processing = processing.then(async () => {
    const lines = (await readFile(witnessPath, 'utf8')).split('\n').filter(Boolean);
    for (; consumed < lines.length; consumed++) {
      let event: Witness;
      try { event = JSON.parse(lines[consumed]!) as Witness; } catch { return; }
      assert.equal(event.token, token);
      events.push(event);
      if (event.stage === 'failure') {
        const error = new Error(`Profile fixture: ${String(event.message)}\n${stripAnsi(output).slice(-6000)}`);
        for (const waiter of eventWaiters) waiter.reject(error);
        eventWaiters.clear();
      }
      for (const waiter of [...eventWaiters]) if (waiter.predicate(event)) { eventWaiters.delete(waiter); waiter.resolve(event); }
    }
  });
  watcher = watch(witnesses, (_event, filename) => { if (String(filename) === 'events.jsonl') void readWitnesses(); });
  bridge = spawn('python3', [fileURLToPath(new URL('./helpers/tui-profile-pty.py', import.meta.url)), process.execPath, cli, '--profile', profile], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  bridge.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    for (const waiter of [...outputWaiters]) if (containsRendered(output, waiter.phrase)) { outputWaiters.delete(waiter); waiter.resolve(); }
  });
  bridge.stderr.on('data', (chunk: Buffer) => { supervisorOutput += chunk.toString('utf8'); });
  closeBridge = new Promise((resolveClose, rejectClose) => {
    bridge!.once('error', rejectClose);
    bridge!.once('close', (code, signal) => {
      bridgeEnded = true;
      const error = new Error(`Profile exited before fixture completion (${code}, ${signal})\n${stripAnsi(output).slice(-8000)}\n${supervisorOutput}`);
      for (const waiter of eventWaiters) waiter.reject(error); eventWaiters.clear();
      for (const waiter of outputWaiters) waiter.reject(error); outputWaiters.clear();
      resolveClose({ code, signal });
    });
  });
  const send = (text: string) => bridge!.stdin.write(JSON.stringify({ action: 'write', text }) + '\n');
  const rendered = (phrase: string): Promise<void> => containsRendered(output, phrase) ? Promise.resolve() : new Promise((resolveRender, rejectRender) => {
    const timer = setTimeout(() => { outputWaiters.delete(waiter); rejectRender(new Error(`Missing terminal rendering ${phrase} in phase ${phase}\n${stripAnsi(output).slice(-8000)}`)); }, 15_000);
    const waiter = { phrase, resolve: () => { clearTimeout(timer); resolveRender(); }, reject: (error: Error) => { clearTimeout(timer); rejectRender(error); } };
    outputWaiters.add(waiter);
  });
  phase = 'entering the documented initial session browser';
  await rendered('This terminal hosts several sessions');
  send('\x1b');
  phase = 'booting actual TUI and completing native fixture';
  const ready = await waiting(event => event.stage === 'ready');
  assert.equal(typeof ready.runId, 'string'); assert.equal(typeof ready.revision, 'number');
  assert.equal(ready.requireCommand, requireCommand);
  assert.equal(typeof ready.commandAvailable, 'boolean');
  if (ready.commandAvailable) {
    phase = 'waiting for admitted adapter progress';
    await rendered('Cross-review: /review report');
    phase = 'invoking mediated report command';
    send(`\x1b[200~/review report ${ready.runId}\x1b[201~\r`);
    const reported = await waiting(event => event.stage === 'report');
    assert.equal(reported.sceneId, 'cross-review-report');
    phase = 'rendering authorized report scene';
    await rendered('Cross-review report [Close]');
    phase = 'closing report scene';
    await writeFile(controlPath, JSON.stringify({ token, action: 'close-scene' }));
    await waiting(event => event.stage === 'scene-closed');
    phase = 'rejecting stale owner revision through mediated command';
    send(`\x1b[200~/review cleanup ${ready.runId} ${Number(ready.revision) - 1}\x1b[201~\r`);
    await waiting(event => event.stage === 'stale-rejected');
    phase = 'cleaning native run through mediated command';
    send(`\x1b[200~/review cleanup ${ready.runId} ${ready.revision}\x1b[201~\r`);
  } else {
    assert.equal(requireCommand, false, 'Full mediated acceptance must never pass when /review is absent');
    const unavailable = await waiting(event => event.stage === 'supported-command-unavailable');
    assert.equal(unavailable.commandAvailable, false); assert.equal(unavailable.sceneId, null);
    phase = 'rendering honest unavailable-command native guidance';
    await rendered('Cross-review: native cross_review_report/control tools; /review unavailable');
    assert.equal(containsRendered(output, 'Cross-review report [Close]'), false);
    phase = 'running genuine owning-Agent native report/control turn';
    await writeFile(controlPath, JSON.stringify({ token, action: 'native-controls' }));
    const started = await waiting(event => event.stage === 'native-controls-started');
    assert.equal(started.route, 'native-owning-agent-tools');
    assert.equal(started.ownerSessionId, ready.ownerSessionId);
    const reported = await waiting(event => event.stage === 'report');
    assert.equal(reported.route, 'native-owning-agent-tools'); assert.equal(reported.toolName, 'cross_review_report');
    assert.equal(reported.sceneId, null); assert.equal(reported.ownerSessionId, ready.ownerSessionId);
    const report = reported.report as { runId: string; snapshotId: string; complete: boolean; revision: number; reviewerCompleted: number; pending: unknown[] };
    assert.equal(report.runId, ready.runId); assert.equal(report.snapshotId, ready.snapshotId);
    assert.equal(report.complete, true); assert.equal(report.revision, ready.revision);
    assert.equal(report.reviewerCompleted, 2); assert.deepEqual(report.pending, []);
    phase = 'checking stale native controls reject without mutation';
    const stale = await waiting(event => event.stage === 'stale-rejected');
    assert.equal(stale.route, 'native-owning-agent-tools'); assert.equal(stale.toolName, 'cross_review_control');
    assert.equal(stale.unchanged, true); assert.equal(stale.revision, ready.revision);
    phase = 'checking native terminal aggregate and snapshot cleanup';
    const cleanup = await waiting(event => event.stage === 'native-cleanup');
    assert.equal(cleanup.removed, ready.runId); assert.equal(cleanup.snapshotId, ready.snapshotId);
    assert.equal(cleanup.runRemoved, true); assert.equal(cleanup.snapshotRemoved, true);
  }
  const completed = await waiting(event => event.stage === 'complete');
  assert.equal(completed.approvals, 1); assert.deepEqual(completed.providerIds, ['fixture-only']);
  assert.equal((completed.childIds as string[]).length, 2);
  assert.equal(new Set(completed.childIds as string[]).size, 2);
  assert.equal(new Set(completed.controllerIds as string[]).size, 2);
  assert.deepEqual(completed.remainingAgentIds, [ready.ownerSessionId]);
  assert.equal(completed.sceneId, null); assert.equal(typeof completed.generationId, 'string');
  const children = events.filter(event => event.stage === 'native-bound-child');
  assert.equal(children.length, 2);
  assert.deepEqual(new Set(children.map(child => child.childId)), new Set(completed.childIds as string[]));
  for (const child of children) {
    assert.equal(child.snapshotId, ready.snapshotId); assert.equal(child.fresh, true);
    assert.equal(child.ownerReportRejected, true); assert.equal(child.ownershipCheckRoute, 'native-shared-service');
  }
  if (!ready.commandAvailable) {
    assert.equal(completed.route, 'native-owning-agent-tools'); assert.equal(completed.nativeControlsDrained, true);
    assert.equal(completed.runRemoved, true); assert.equal(completed.snapshotRemoved, true);
    assert.equal(containsRendered(output, 'Cross-review report [Close]'), false);
    assert.equal(events.some(event => event.stage === 'scene-closed'), false);
  }
  phase = 'disposing genuine TUI profile';
  bridge.stdin.write(JSON.stringify({ action: 'stop' }) + '\n');
  const ended = await closeBridge;
  assert.equal(ended.code, 0, supervisorOutput);
  assert.match(supervisorOutput, /PTY_CHILD_EXIT=.*"code":\s*0/);
  await readWitnesses();
  const disposed = events.find(event => event.stage === 'fixture-disposed');
  assert.ok(disposed, 'The public plugin lifecycle must dispose the fixture before process exit');
  assert.deepEqual(disposed.providerIds, []); assert.equal(disposed.watcherClosed, true);
  if (!ready.commandAvailable) assert.equal(disposed.nativeControlState, 'drained');
  proofComplete = true;
  t.diagnostic(ready.commandAvailable
    ? 'Actual public DSH profile + TUI PTY + optional mediated adapter + native scripted reviewer pipeline verified; no paid adapters mounted.'
    : 'Supported public DSH profile + genuine TUI PTY + fixture-only native owning-Agent cross_review_report/control tools verified; /review remains unavailable and no report scene was opened. This is not mediated TUI command acceptance.');
  if (install.stderr) t.diagnostic('Package-manager warnings were retained as fixture diagnostics; no user-profile installation or paid model adapter was mounted.');
});
