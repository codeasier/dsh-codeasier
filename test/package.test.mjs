import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

// Registry metadata is not populated by a frozen pnpm install. Keep this
// explicit network/package-manager gate separate from offline native regressions.
const enabled = process.env.DSH_CODEASIER_PACKAGE_TEST === '1';
test('packed Host and optional entry import in a production-only project without React or TUI', { skip: !enabled, timeout: 150_000 }, async t => {
  await stat(join(repository, 'dist/host.js')); // Run pnpm build before this separate gate.
  const parent = await realpath(tmpdir());
  const scratch = await realpath(await mkdtemp(join(parent, 'dsh-package-smoke-')));
  t.after(async () => {
    assert.equal(resolve(scratch), scratch); assert.equal(dirname(scratch), parent);
    assert.ok(basename(scratch).startsWith('dsh-package-smoke-')); assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  });
  const { stdout } = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: repository });
  const [packed] = JSON.parse(stdout);
  assert.ok(packed && /^[a-z0-9_.-]+\.tgz$/.test(packed.filename));
  const paths = packed.files.map(file => file.path);
  for (const required of ['dist/host.js', 'dist/host.d.ts', 'dist/tui.js', 'dist/protocol.js', 'dsh-plugin.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'docs/contracts.md', 'docs/tui-admission-gap.md']) assert.ok(paths.includes(required), `missing ${required}`);
  for (const path of paths) assert.equal(/(^|\/)(?:\.git|\.worktrees|\.dsh-codeasier|node_modules|test|src|\.env(?:\..*)?)(?:\/|$)/.test(path), false, `private/development artifact packaged: ${path}`);
  const { packageManager } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  assert.equal(packageManager, 'pnpm@11.21.0');
  await writeFile(join(scratch, 'package.json'), JSON.stringify({ name: 'isolated-production-smoke', private: true, type: 'module', packageManager }));
  await writeFile(join(scratch, 'empty.npmrc'), '');
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DSH_|NPM_CONFIG_|npm_config_|PNPM_|GIT_)/.test(key) || /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: scratch, USERPROFILE: scratch, DSH_HOME: join(scratch, 'dsh-home'),
    XDG_CONFIG_HOME: join(scratch, '.config'), XDG_CACHE_HOME: join(scratch, '.cache'),
    NPM_CONFIG_USERCONFIG: join(scratch, 'empty.npmrc'), NPM_CONFIG_GLOBALCONFIG: join(scratch, 'empty.npmrc') });
  await execute('pnpm', ['install', '--prod', '--ignore-scripts', '--lockfile=false', '--store-dir', join(scratch, 'pnpm-store'), join(scratch, packed.filename)], { cwd: scratch, env, timeout: 120_000 });
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(new URL('./package.json', import.meta.url));
    assert.throws(() => require.resolve('react'), { code: 'MODULE_NOT_FOUND' });
    assert.throws(() => require.resolve('@deepseek-harness-tui/dsh-tui/package.json'), { code: 'MODULE_NOT_FOUND' });
    const host = await import('dsh-codeasier');
    assert.equal(typeof host.apply, 'function');
    assert.equal(typeof host.CrossReviewService, 'function');
    const optional = await import('dsh-codeasier/tui');
    const handle = optional.mountTuiAdapter({ get() { return undefined; } });
    assert.equal(handle.capabilities.command, false);
    handle.dispose();
    console.log('production-only exports verified');
  `;
  const result = await execute(process.execPath, ['--input-type=module', '-e', script], { cwd: scratch, env, timeout: 20_000 });
  assert.match(result.stdout, /production-only exports verified/);
});
