import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.DSH_CODEASIER_AUDIT_PACKAGE_TEST === '1';
// No installs. This gate deliberately shares only the existing locked dependency
// cohort read-only; it is NOT a production-install or real CLI-profile gate.
test('offline packed audit exports and actual public Loader activation without UI imports', { skip: !enabled, timeout: 30_000 }, async t => {
  const temporary = await realpath(tmpdir()); const scratch = await realpath(await mkdtemp(join(temporary, 'dsh-audit-package-')));
  t.after(async () => {
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), temporary); assert.ok(basename(scratch).startsWith('dsh-audit-package-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DSH_|NPM_CONFIG_|npm_config_|PNPM_|GIT_)/.test(key) && !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
  Object.assign(env, { HOME: scratch, DSH_HOME: join(scratch, '.dsh'), XDG_CONFIG_HOME: join(scratch, '.config'), XDG_CACHE_HOME: join(scratch, '.cache') });
  const packedOutput = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: repository, env });
  const [packed] = JSON.parse(packedOutput.stdout); assert.match(packed.filename, /^[a-z0-9_.-]+\.tgz$/);
  const paths = packed.files.map(file => file.path);
  for (const resource of ['dist/plugins/cross-review-audit/index.js', 'dist/plugins/cross-review-audit/index.d.ts', 'dist/plugins/cross-review-audit/audit.js', 'plugins/cross-review-audit/plugin.json', 'plugins/cross-review-audit/cordis.patch.yml', 'plugins/cross-review-audit/SKILL.md', 'plugins/cross-review-audit/README.md', 'plugins/cross-review-audit/README.zh-CN.md', 'plugins/cross-review-audit/LICENSE']) assert.ok(paths.includes(resource), resource);
  assert.ok(paths.every(path => !path.startsWith('/') && !path.split('/').includes('..') && !/(^|\/)(?:node_modules|\.git|\.worktrees|\.dsh-codeasier|src|test)(\/|$)/.test(path)));
  await execute('tar', ['-xzf', join(scratch, packed.filename), '-C', scratch], { cwd: repository, env });
  const artifact = join(scratch, 'package'); assert.equal(await realpath(artifact), artifact);
  await symlink(await realpath(join(repository, 'node_modules')), join(artifact, 'node_modules'));
  await writeFile(join(artifact, 'deny-ui.mjs'), `export async function resolve(specifier, context, next) { if (specifier === 'react' || specifier.startsWith('react/') || specifier.startsWith('@deepseek-harness-tui/')) throw new Error('Unexpected Host UI import: ' + specifier); return next(specifier, context); }\n`);
  await writeFile(join(artifact, 'smoke.mjs'), `
    import assert from 'node:assert/strict';
    import { register } from 'node:module';
    import { readFile } from 'node:fs/promises';
    import { randomUUID } from 'node:crypto';
    register('./deny-ui.mjs', import.meta.url);
    const { Context } = await import('@deepseek-ai/cordis');
    const { default: Loader } = await import('@deepseek-ai/cordis-plugin-loader');
    const { default: Storage } = await import('@deepseek-ai/dsh-storage');
    const { default: Subagents } = await import('@deepseek-ai/dsh-subagent');
    const { SessionId } = await import('@deepseek-ai/dsh-session');
    const { ToolCallId } = await import('@deepseek-ai/dsh-llm');
    const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await import('@deepseek-ai/dsh-agent-loop-testkit');
    const { parse } = await import('yaml');
    const audit = await import('dsh-codeasier/plugins/cross-review-audit');
    assert.equal(audit.name, 'cross-review-audit'); assert.deepEqual(audit.inject, ['tools', 'crossReview']);
    const descriptor = JSON.parse(await readFile(new URL('./plugins/cross-review-audit/plugin.json', import.meta.url), 'utf8'));
    assert.equal(descriptor.status, 'implemented'); assert.equal(descriptor.defaultEnabled, false);
    const standalone = parse(await readFile(new URL('./plugins/cross-review-audit/cordis.patch.yml', import.meta.url), 'utf8'))[0].insert[0];
    const aggregate = parse(await readFile(new URL('./cordis.patch.yml', import.meta.url), 'utf8')).flatMap(op => op.insert);
    const aggregateAudit = aggregate.find(row => row.id === 'cross-review-audit');
    assert.equal(aggregateAudit.disabled, true); assert.equal(aggregateAudit.name, standalone.name); assert.equal(standalone.disabled, true);
    const legacy = aggregate.find(row => row.id === 'cross-review'); assert.equal(legacy.name, 'dsh-codeasier');
    const ctx = new Context();
    try {
      await mountAgentLoopTestDependencies(ctx); await ctx.plugin(Storage); await ctx.plugin(Subagents, {});
      const harness = await mountAgentLoopTestHarness(ctx);
      const parent = await harness.create(SessionId('package-audit-parent'), {}, { cwd: ${JSON.stringify(artifact)} });
      await ctx.plugin(Loader, { baseUrl: import.meta.url });
      await ctx.loader.create({ ...legacy, config: { root: ${JSON.stringify(join(scratch, 'store'))}, review: { reviewers: [{ id: 'fixture', provider: 'unused', model: 'unused', focus: 'offline' }] }, preauthorizedDigests: [] } });
      await ctx.loader.await();
      assert.ok(ctx.crossReview, 'actual packed CrossReview Host must mount');
      await ctx.loader.create(aggregateAudit); assert.equal(ctx.tools.get('cross_review_audit', parent), undefined);
      await ctx.loader.update('cross-review-audit', { ...aggregateAudit, disabled: false }); await ctx.loader.await();
      assert.ok(ctx.tools.get('cross_review_audit', parent), 'actual packed audit tool must mount');
      const denied = await ctx.tools.execute({ agent: parent, name: 'cross_review_audit', arguments: { runId: randomUUID() }, callId: ToolCallId(randomUUID()), signal: new AbortController().signal });
      assert.equal(denied.isError, true); assert.match(denied.error.message, /ownership/);
      await ctx.loader.update('cross-review-audit', { ...aggregateAudit, disabled: true }); await ctx.loader.await();
      assert.equal(ctx.tools.get('cross_review_audit', parent), undefined); assert.ok(ctx.crossReview);
      assert.equal(ctx.get('tuiPluginHost', false), undefined);
      console.log('offline packed public Loader audit verified; production install and CLI profile not-run');
    } finally { await ctx.fiber.dispose(); }
  `);
  const result = await execute(process.execPath, [join(artifact, 'smoke.mjs')], { cwd: artifact, env, timeout: 15_000 });
  assert.match(result.stdout, /offline packed public Loader audit verified/);
  t.diagnostic(result.stdout.trim());
  assert.ok((await readFile(join(artifact, 'plugins/cross-review-audit/LICENSE'), 'utf8')).includes('Copyright (c) 2026 codeasier'));
});
