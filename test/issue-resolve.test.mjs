import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectPlugins } from '../scripts/lib/plugins.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const skill = await readFile(new URL('../plugins/issue-resolve/SKILL.md', import.meta.url), 'utf8');
// Execute the shipped instructions, not a second implementation of their policy.
function snippet(name) {
  const start = `<!-- issue-resolve:${name}:start -->\n\`\`\`js\n`;
  const end = `\n\`\`\`\n<!-- issue-resolve:${name}:end -->`;
  assert.equal(skill.split(start).length, 2, `Exactly one ${name} example`);
  return skill.split(start)[1].split(end)[0];
}
const scripts = Object.fromEntries(['preflight', 'verification', 'file-inspection'].map(name => [name, snippet(name)]));

async function fixture(t) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'dsh-issue-resolve-')));
  const identity = await lstat(root);
  t.after(async () => {
    // Only this exact newly-created private fixture may be removed. No worktree remove/prune.
    assert.equal(resolve(root), root); assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('dsh-issue-resolve-'));
    assert.equal(await realpath(root), root);
    const current = await lstat(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.equal(current.uid, identity.uid);
    t.diagnostic(`cleanup verified exact temporary root: ${root}`);
    await rm(root, { recursive: true, force: false });
  });
  const repo = join(root, 'repository');
  const home = join(root, 'home');
  const remote = join(root, 'remote.git');
  await mkdir(repo); await mkdir(home);
  // Do not inherit user Git configuration, credentials, hooks or GIT_* routing.
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const commands = [];
  function run(command, args, cwd = repo, expected = 0) {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    commands.push({ command: [command, ...args], cwd, exitCode: result.status });
    assert.ifError(result.error);
    assert.equal(result.status, expected, `${command} ${args.join(' ')} in ${cwd}: ${result.stderr}`);
    return result.stdout.trim();
  }
  const git = (args, cwd = repo, expected = 0) => run('git', args, cwd, expected);
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Offline issue fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  git(['init', '--bare', remote]); git(['remote', 'add', 'origin', remote]);
  await writeFile(join(repo, '.gitignore'), '.worktrees/\nignored.txt\n*.trace\n');
  for (const name of ['affected.txt', 'staged.txt', 'unstaged.txt']) await writeFile(join(repo, name), 'bug\n');
  await writeFile(join(repo, 'check.mjs'), `import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
appendFileSync('checks.trace', mode + '\\n');
if (mode === 'focused-fail') process.exit(7);
if (mode === 'full-fail') process.exit(9);
assert.equal(readFileSync('affected.txt', 'utf8'), 'fixed\\n');
if (mode === 'full') {
  const result = spawnSync(process.execPath, ['--test', 'regression.test.mjs'], { encoding: 'utf8' });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}
`);
  git(['add', '--', '.gitignore', 'affected.txt', 'staged.txt', 'unstaged.txt', 'check.mjs']);
  git(['commit', '-m', 'fixture baseline']);
  const base = git(['rev-parse', 'HEAD']);
  const target = join(repo, '.worktrees', 'issue-8');
  const inputs = { REPOSITORY_ROOT: repo, EXPECTED_ORIGIN: remote, ISSUE_NUMBER: '8', BASE_COMMIT: base,
    WORKTREE: target, BRANCH: 'issue/8', ISSUE_READ: 'complete', READ_INTERFACE: 'confirmed',
    FOCUSED_CHECK: 'node check.mjs focused', FULL_CHECK: 'node check.mjs full' };
  function execute(name, overrides = {}, cwd = repo, expected = 0) {
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd, env: { ...env, ...inputs, ...overrides }, input: scripts[name], encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.cwd ?? report.binding?.cwd, cwd);
    assert.equal(report.status, expected === 0 ? 'passed' : 'failed');
    return report;
  }
  async function create() {
    execute('preflight');
    await mkdir(dirname(target));
    git(['worktree', 'add', '-b', inputs.BRANCH, target, base]);
    return execute('preflight', { REUSE_OWNED: 'yes' }, target);
  }
  async function fix() {
    execute('file-inspection', { EDIT_PATH: join(target, 'affected.txt') }, target);
    assert.equal(await readFile(join(target, 'affected.txt'), 'utf8'), 'bug\n');
    await writeFile(join(target, 'affected.txt'), 'fixed\n');
    execute('file-inspection', { EDIT_PATH: join(target, 'regression.test.mjs') }, target);
    await writeFile(join(target, 'regression.test.mjs'), `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.equal(readFileSync('affected.txt', 'utf8'), 'fixed\\n');\n`);
  }
  return { root, repo, target, remote, base, inputs, env, commands, git, execute, create, fix };
}

async function sourceState(f) {
  return { status: f.git(['status', '--porcelain=v1', '--untracked-files=all']),
    staged: f.git(['diff', '--cached', '--binary']), unstaged: f.git(['diff', '--binary']),
    indexEntries: f.git(['ls-files', '--stage']), head: f.git(['rev-parse', 'HEAD']),
    bytes: await Promise.all(['affected.txt', 'staged.txt', 'unstaged.txt', 'untracked.txt', 'ignored.txt']
      .map(path => readFile(join(f.repo, path), 'utf8'))) };
}

async function dirtySource(f) {
  await writeFile(join(f.repo, 'staged.txt'), 'user staged\n'); f.git(['add', '--', 'staged.txt']);
  await writeFile(join(f.repo, 'unstaged.txt'), 'user unstaged\n');
  await writeFile(join(f.repo, 'untracked.txt'), 'user untracked\n');
  await writeFile(join(f.repo, 'ignored.txt'), 'user ignored\n');
}

test('issue-resolve is a licensed Skill asset, with no native activation or installer', async () => {
  const plugin = (await inspectPlugins(repository)).find(plugin => plugin.id === 'issue-resolve');
  assert.equal(plugin.kind, 'skill'); assert.equal(plugin.status, 'implemented');
  assert.equal(plugin.skill, 'plugins/issue-resolve/SKILL.md');
  assert.equal(plugin.entry, undefined); assert.equal(plugin.patch, undefined);
  for (const path of ['src/plugins/issue-resolve', 'plugins/issue-resolve/cordis.patch.yml', 'plugins/issue-resolve/tui.patch.yml']) {
    await assert.rejects(lstat(join(repository, path)), { code: 'ENOENT' });
  }
  assert.match(skill, /20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/);
  assert.match(skill, /23f067cb557bbbb2fc5eeb759fc682346f4e8dd5/);
  assert.match(skill, /Copyright \(c\) 2026 codeasier/);
  assert.equal(await readFile(join(repository, 'plugins/issue-resolve/LICENSE'), 'utf8'), await readFile(join(repository, 'LICENSE'), 'utf8'));
  // Wording/metadata assertions are separate from the actual command rehearsals below.
  assert.match(skill, /No push without an explicit user request/);
  assert.match(skill, /PR creation[\s\S]*worktree deletion[\s\S]*separately scoped authorization/);
  assert.match(skill, /not an OS sandbox/); assert.match(skill, /Before an uncertain remote write is retried, read back/);
  assert.match(skill, /DSH `0\.2\.0-rc\.2`[\s\S]*only to the exact live runtime root/);
  assert.match(skill, /owned child must return missing choices or confirmations to the main\/root Agent/);
  assert.match(skill, /not wait for a human reply or treat pending\/unavailable questions as authorization/);
});

test('actual issue rehearsal preserves dirty source/index, reproduces regression, fixes in worktree and commits only named files', async t => {
  const f = await fixture(t); await dirtySource(f);
  const before = await sourceState(f);
  const initial = f.execute('preflight');
  assert.match(initial.binding.sourceStatus, /^M  staged\.txt$/m); assert.deepEqual(initial.binding.sourceIgnored, ['ignored.txt']);
  const bound = await f.create();
  assert.equal(bound.binding.worktree, await realpath(f.target)); assert.equal(bound.binding.base, f.base);
  const reproduction = f.execute('verification', {}, f.target, 1);
  assert.equal(reproduction.checks[0].exitCode, 1); assert.equal(reproduction.checks[1].status, 'not-run');
  await f.fix();
  const verified = f.execute('verification', {}, f.target);
  assert.deepEqual(verified.checks.map(check => [check.name, check.cwd, check.exitCode, check.status]),
    [['focused', f.target, 0, 'passed'], ['full', f.target, 0, 'passed']]);
  f.git(['add', '--', 'affected.txt', 'regression.test.mjs'], f.target);
  assert.deepEqual(f.git(['diff', '--cached', '--name-only'], f.target).split('\n'), ['affected.txt', 'regression.test.mjs']);
  f.git(['commit', '-m', 'fix fixture issue 8'], f.target);
  assert.deepEqual(f.git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], f.target).split('\n'), ['affected.txt', 'regression.test.mjs']);
  assert.deepEqual(await sourceState(f), before);
  assert.equal(f.git(['--git-dir', f.remote, 'show-ref', '--quiet'], f.repo, 1), ''); // No push/PR side effect.
  assert.ok((await lstat(f.target)).isDirectory()); // No automatic worktree removal.
  t.diagnostic(JSON.stringify({ preflight: bound, reproduction, verified, gitCommands: f.commands }));
});

test('single-issue, repository, baseline, interface and test-entrypoint prerequisites stop before creation', async t => {
  const f = await fixture(t);
  for (const overrides of [{ ISSUE_NUMBER: '' }, { ISSUE_NUMBER: '8,9' }, { ISSUE_NUMBER: '0' },
    { EXPECTED_ORIGIN: 'another-repository' }, { BASE_COMMIT: 'main' }, { BASE_COMMIT: 'f'.repeat(40) },
    { READ_INTERFACE: '' }, { ISSUE_READ: 'body-only' }, { FOCUSED_CHECK: '' }, { FULL_CHECK: '' },
    { BRANCH: '--bad-branch' }, { PATH: join(f.root, 'missing-bin') }]) {
    const report = f.execute('preflight', overrides, f.repo, 1);
    assert.ok(report.reason);
    await assert.rejects(lstat(f.target), { code: 'ENOENT' });
    f.git(['show-ref', '--verify', '--quiet', `refs/heads/${f.inputs.BRANCH}`], f.repo, 1);
  }
  assert.equal(f.git(['status', '--porcelain=v1', '--untracked-files=all']), '');
});

test('absolute path escape and wrong actual cwd stop; no main-checkout fallback', async t => {
  const f = await fixture(t);
  for (const target of ['.worktrees/issue-8', join(f.root, 'escape'), `${f.repo}/.worktrees/../escape`, f.repo]) {
    f.execute('preflight', { WORKTREE: target }, f.repo, 1);
  }
  f.execute('preflight', {}, f.root, 1);
  await f.create(); await f.fix();
  const report = f.execute('verification', {}, f.repo, 1);
  assert.match(report.reason, /cwd\/worktree mismatch/);
  assert.ok(report.checks.every(check => check.status === 'not-run' && check.exitCode === null));
  assert.equal(await readFile(join(f.repo, 'affected.txt'), 'utf8'), 'bug\n');
  await assert.rejects(lstat(join(f.repo, 'checks.trace')), { code: 'ENOENT' });
});

test('preexisting file/directory paths are not overwritten or automatically assigned', async t => {
  const f = await fixture(t); await mkdir(dirname(f.target));
  const file = join(dirname(f.target), 'user-file'); await writeFile(file, 'owned by user\n');
  f.execute('preflight', { WORKTREE: file }, f.repo, 1);
  assert.equal(await readFile(file, 'utf8'), 'owned by user\n');
  await mkdir(f.target); await writeFile(join(f.target, 'sentinel'), 'keep\n');
  f.execute('preflight', {}, f.repo, 1);
  f.execute('preflight', { REUSE_OWNED: 'yes' }, f.repo, 1);
  assert.equal(await readFile(join(f.target, 'sentinel'), 'utf8'), 'keep\n');
});

test('unsafe symlinked worktree parent, target and dangling destination refuse without touching targets', async t => {
  const f = await fixture(t); const outside = join(f.root, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'sentinel'), 'untouched\n');
  const linked = join(f.repo, '.worktrees'); await symlink(outside, linked);
  f.execute('preflight', {}, f.repo, 1);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'untouched\n');
  // Other independent destinations use another repository fixture, not removal of a link.
  const other = await fixture(t); await mkdir(dirname(other.target));
  await symlink(outside, other.target);
  other.execute('preflight', { REUSE_OWNED: 'yes' }, other.repo, 1);
  const dangling = join(dirname(other.target), 'dangling'); await symlink(join(other.root, 'missing'), dangling);
  other.execute('preflight', { WORKTREE: dangling }, other.repo, 1);
  assert.equal((await lstat(dangling)).isSymbolicLink(), true);
});

test('a repository .git symlink is rejected without following it as an owned Git binding', async t => {
  const f = await fixture(t); const linkedRepo = join(f.root, 'linked-repository'); await mkdir(linkedRepo);
  await symlink(join(f.repo, '.git'), join(linkedRepo, '.git'));
  const report = f.execute('preflight', { REPOSITORY_ROOT: linkedRepo,
    WORKTREE: join(linkedRepo, '.worktrees', 'issue-8') }, linkedRepo, 1);
  assert.match(report.reason, /Unsafe repository Git binding/); assert.deepEqual(report.evidence, []);
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
});

test('existing unregistered branch and registered branch at a different worktree are conflicts, not reset candidates', async t => {
  const f = await fixture(t);
  f.git(['branch', f.inputs.BRANCH, f.base]);
  const report = f.execute('preflight', {}, f.repo, 1); assert.match(report.reason, /Existing branch conflict/);
  await assert.rejects(lstat(f.target), { code: 'ENOENT' });
  const other = join(f.root, 'other-worktree'); f.git(['worktree', 'add', other, f.inputs.BRANCH]);
  const registered = f.execute('preflight', {}, f.repo, 1); assert.match(registered.reason, /Registered worktree\/branch conflict/);
  assert.equal(f.git(['rev-parse', 'HEAD'], other), f.base);
});

test('assigned worktree must match explicit assignment, branch, base and repository ownership', async t => {
  const f = await fixture(t); await f.create();
  f.execute('preflight', {}, f.target, 1);
  f.execute('preflight', { REUSE_OWNED: 'yes', BRANCH: 'another-branch' }, f.target, 1);
  f.git(['commit', '--allow-empty', '-m', 'unrelated worktree commit'], f.target);
  const changed = f.execute('preflight', { REUSE_OWNED: 'yes' }, f.target, 1); assert.match(changed.reason, /HEAD differs/);
  const foreign = await fixture(t); await mkdir(dirname(foreign.target));
  f.git(['worktree', 'add', '-b', 'foreign/8', foreign.target, f.base]);
  const ownership = foreign.execute('preflight', { REUSE_OWNED: 'yes', BRANCH: 'foreign/8' }, foreign.repo, 1);
  assert.match(ownership.reason, /ownership mismatch/);
});

test('staged, unstaged and untracked changes in assigned worktree stop and preserve user bytes/index', async t => {
  for (const kind of ['staged', 'unstaged', 'untracked']) {
    const f = await fixture(t); await f.create();
    const path = join(f.target, kind === 'untracked' ? 'user.txt' : 'affected.txt');
    await readFile(join(f.target, 'affected.txt'), 'utf8');
    await writeFile(path, `user ${kind}\n`);
    if (kind === 'staged') f.git(['add', '--', 'affected.txt'], f.target);
    const before = f.git(['status', '--porcelain=v1', '--untracked-files=all'], f.target);
    const staged = f.git(['diff', '--cached', '--binary'], f.target);
    const report = f.execute('preflight', { REUSE_OWNED: 'yes' }, f.target, 1);
    assert.match(report.reason, /Dirty assigned worktree/);
    assert.equal(await readFile(path, 'utf8'), `user ${kind}\n`);
    assert.equal(f.git(['status', '--porcelain=v1', '--untracked-files=all'], f.target), before);
    assert.equal(f.git(['diff', '--cached', '--binary'], f.target), staged);
  }
});

test('actual file inspection rejects symlinks, user collisions, VCS/dependency paths and escapes', async t => {
  const f = await fixture(t); await f.create();
  await writeFile(join(f.repo, 'user-outside.txt'), 'user outside\n');
  await symlink(join(f.repo, 'user-outside.txt'), join(f.target, 'linked.txt'));
  await symlink(f.repo, join(f.target, 'linked-parent'));
  await writeFile(join(f.target, 'user.txt'), 'untracked user\n');
  await writeFile(join(f.target, 'ignored.txt'), 'ignored user\n');
  for (const path of [join(f.target, 'linked.txt'), join(f.target, 'linked-parent', 'new.txt'),
    join(f.target, 'user.txt'), join(f.target, 'ignored.txt'), join(f.repo, 'affected.txt'),
    join(f.target, '.git'), join(f.target, 'node_modules', 'dependency.js')]) {
    f.execute('file-inspection', { EDIT_PATH: path }, f.target, 1);
  }
  assert.equal(await readFile(join(f.repo, 'user-outside.txt'), 'utf8'), 'user outside\n');
  assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'untracked user\n');
  assert.equal(await readFile(join(f.target, 'ignored.txt'), 'utf8'), 'ignored user\n');
  f.execute('file-inspection', { EDIT_PATH: join(f.target, 'new', 'regression.test.mjs') }, f.target);
});

test('focused failure stops full check, records actual exit code and preserves worktree/source', async t => {
  const f = await fixture(t); await dirtySource(f); const before = await sourceState(f);
  await f.create(); await f.fix();
  const report = f.execute('verification', { FOCUSED_CHECK: 'node check.mjs focused-fail' }, f.target, 1);
  assert.deepEqual(report.checks.map(check => [check.status, check.exitCode]), [['failed', 7], ['not-run', null]]);
  assert.equal(await readFile(join(f.target, 'checks.trace'), 'utf8'), 'focused-fail\n');
  assert.equal(f.git(['rev-parse', 'HEAD'], f.target), f.base); assert.deepEqual(await sourceState(f), before);
  assert.equal(await readFile(join(f.target, 'affected.txt'), 'utf8'), 'fixed\n');
  t.diagnostic(JSON.stringify(report));
});

test('full failure remains failed after focused success, with no completion commit or cleanup', async t => {
  const f = await fixture(t); await f.create(); await f.fix();
  const report = f.execute('verification', { FULL_CHECK: 'node check.mjs full-fail' }, f.target, 1);
  assert.deepEqual(report.checks.map(check => [check.status, check.exitCode]), [['passed', 0], ['failed', 9]]);
  assert.equal(await readFile(join(f.target, 'checks.trace'), 'utf8'), 'focused\nfull-fail\n');
  assert.equal(f.git(['rev-parse', 'HEAD'], f.target), f.base);
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base); assert.ok((await lstat(f.target)).isDirectory());
  t.diagnostic(JSON.stringify(report));
});

test('missing checks and changed branch/baseline stop verification before command execution', async t => {
  const f = await fixture(t); await f.create(); await f.fix();
  const missing = f.execute('verification', { FULL_CHECK: '' }, f.target, 1);
  assert.ok(missing.checks.every(check => check.status === 'not-run'));
  f.execute('verification', { REPOSITORY_ROOT: '' }, f.target, 1);
  f.execute('verification', { BRANCH: 'wrong-branch' }, f.target, 1);
  f.execute('verification', { BASE_COMMIT: 'f'.repeat(40) }, f.target, 1);
  await assert.rejects(lstat(join(f.target, 'checks.trace')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.repo, 'affected.txt'), 'utf8'), 'bug\n');
});
