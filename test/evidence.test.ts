import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { listEvidence, prepareEvidence, readEvidence, validateSnapshot } from '../src/evidence.js';

const exec = promisify(execFile);
async function temporary(t: TestContext): Promise<string> {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'evidence-test-')));
  t.after(async () => {
    // Verify the exact generated target before every recursive deletion.
    assert.equal(await realpath(root), root);
    assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('evidence-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })).stdout.trim();
}
async function repository(t: TestContext): Promise<{ root: string; base: string }> {
  const root = await temporary(t);
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.name', 'Evidence Test');
  await git(root, 'config', 'user.email', 'evidence@example.invalid');
  await writeFile(join(root, 'main.ts'), 'export const value = 1;\n');
  await git(root, 'add', '--', 'main.ts');
  await git(root, 'commit', '-qm', 'base');
  return { root, base: await git(root, 'rev-parse', 'HEAD') };
}
async function commit(root: string): Promise<string> {
  await git(root, 'add', '-A'); await git(root, 'commit', '-qm', 'change'); return git(root, 'rev-parse', 'HEAD');
}

function publicPr(t: TestContext, base: string, head: string, fork = false): void {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ number: 7,
    base: { sha: base, repo: { clone_url: 'https://github.com/owner/repo.git' } },
    head: { sha: head, repo: { clone_url: `https://github.com/${fork ? 'fork' : 'owner'}/repo.git` } },
  }));
}

// Only the test transport maps validated public remotes to local fixture repos.
// Production Git continues to prohibit file transport and credential helpers.
async function fixtureFetch(t: TestContext, remotes: Record<string, string>, blocked = false, unchanged = false, mergeBaseExit?: number): Promise<() => Promise<string[][]>> {
  const scratch = await temporary(t); const log = join(scratch, 'fetches.json');
  const realGit = (await exec('which', ['git'])).stdout.trim();
  await writeFile(join(scratch, 'git'), `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2); const remotes=${JSON.stringify(remotes)};
if(args.includes('merge-base') && ${mergeBaseExit !== undefined}) process.exit(${mergeBaseExit ?? 0});
if(args.includes('fetch')) {
 let calls=[]; try {calls=JSON.parse(fs.readFileSync(${JSON.stringify(log)},'utf8'));} catch {}
 calls.push(args); fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(calls));
 if(${blocked}) process.exit(1);
 if(${unchanged}) process.exit(0);
 const i=args.indexOf('--'); const source=remotes[args[i+1]]; if(!source) process.exit(2);
 args[i+1]='file://'+source;
}
const child=cp.spawnSync(${JSON.stringify(realGit)},['-c','protocol.file.allow=always',...args],{stdio:'inherit'});process.exit(child.status??1);
`);
  await chmod(join(scratch, 'git'), 0o755);
  const path = process.env.PATH; process.env.PATH = `${scratch}:${path ?? ''}`; t.after(() => { process.env.PATH = path; });
  return async () => { try { return JSON.parse(await readFile(log, 'utf8')); } catch { return []; } };
}

test('PR evidence excludes destination-only changes while explicit ranges retain two-tip semantics', async t => {
  const { root, base: mergeBase } = await repository(t);
  await git(root, 'checkout', '-qb', 'topic');
  await writeFile(join(root, 'topic.ts'), 'PR change\n'); const head = await commit(root);
  await git(root, 'checkout', '-qb', 'destination', mergeBase);
  await writeFile(join(root, 'base-only.ts'), 'destination change\n'); const base = await commit(root);
  publicPr(t, base, head, true);
  const calls = await fixtureFetch(t, {}, true);
  const snapshot = await prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' });
  assert.deepEqual(snapshot.provenance, { base, head, mergeBase });
  assert.match(snapshot.diff, /topic.ts/); assert.doesNotMatch(snapshot.diff, /base-only.ts/);
  const range = await prepareEvidence({ kind: 'range', root, base, head });
  assert.deepEqual(range.provenance, { base, head }); assert.match(range.diff, /base-only.ts/);
  await writeFile(join(root, 'later.ts'), 'branch advanced\n'); await commit(root);
  assert.equal(validateSnapshot(snapshot).id, snapshot.id);
  const tampered = JSON.parse(JSON.stringify(snapshot)); tampered.provenance.mergeBase = base;
  assert.throws(() => validateSnapshot(tampered), /hash mismatch/);
  assert.equal((await calls()).length, 0);
});

test('local and range evidence reject PR-only merge-base provenance', async t => {
  const { root, base } = await repository(t);
  for (const target of [{ kind: 'local', root }, { kind: 'range', root, base, head: base }] as const) {
    const snapshot = await prepareEvidence(target);
    assert.throws(() => validateSnapshot({ ...snapshot, provenance: { ...snapshot.provenance, mergeBase: base } }), /merge-base is only valid for PR evidence/);
  }
});

test('merge-base execution failure is not reported as unrelated ancestry', async t => {
  const { root, base } = await repository(t); publicPr(t, base, base);
  const calls = await fixtureFetch(t, {}, true, false, 128);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /^Error: Evidence: Git merge-base failed$/);
  assert.equal((await calls()).length, 0);
});

test('deepening fetch failures identify their stage without declaring a deleted fork', async t => {
  const { root, base: ancestor } = await repository(t);
  await writeFile(join(root, 'main.ts'), 'base\n'); const base = await commit(root);
  await git(root, 'checkout', '-qb', 'topic', ancestor);
  await writeFile(join(root, 'main.ts'), 'head\n'); const head = await commit(root);
  await writeFile(join(root, '.git', 'shallow'), `${base}\n${head}\n`);
  publicPr(t, base, head); const calls = await fixtureFetch(t, {}, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /during history deepening \(64 commits\); Git fetch failed \(local, network or remote access failure\)/);
  assert.equal((await calls()).length, 1);
});

test('shallow fork histories deepen using frozen SHAs from their own remotes', async t => {
  const { root: upstream, base: mergeBase } = await repository(t);
  const fork = await temporary(t);
  await git(fork, 'clone', '-q', upstream, '.');
  await git(fork, 'config', 'user.name', 'Evidence Test'); await git(fork, 'config', 'user.email', 'evidence@example.invalid');
  await writeFile(join(fork, 'topic.ts'), 'fork change\n'); const head = await commit(fork);
  await writeFile(join(upstream, 'base-only.ts'), 'destination change\n'); const base = await commit(upstream);
  const root = await temporary(t); await git(root, 'clone', '-q', '--depth=1', `file://${upstream}`, '.');
  publicPr(t, base, head, true);
  const calls = await fixtureFetch(t, { 'https://github.com/owner/repo.git': upstream, 'https://github.com/fork/repo.git': fork });
  const snapshot = await prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' });
  assert.deepEqual(snapshot.provenance, { base, head, mergeBase });
  assert.doesNotMatch(snapshot.diff, /base-only.ts/); assert.match(snapshot.diff, /topic.ts/);
  const fetches = await calls(); assert.ok(fetches.some(args => args.includes('--deepen=64')));
  for (const args of fetches) {
    const remote = args[args.indexOf('--') + 1]; const sha = args.at(-1);
    assert.equal(sha, remote === 'https://github.com/owner/repo.git' ? base : head);
  }
});

test('inaccessible fork history fails clearly without falling back to destination-tip evidence', async t => {
  const { root, base } = await repository(t); publicPr(t, base, '1'.repeat(40), true);
  const calls = await fixtureFetch(t, {}, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /public PR commit history unavailable during initial commit fetch; Git fetch failed \(local, network or remote access failure\)/);
  assert.equal((await calls()).length, 1);
});

test('an older merge-base in a shallow graph is not accepted while a side path is truncated', async t => {
  const { root: upstream, base: older } = await repository(t);
  await writeFile(join(upstream, 'base.ts'), 'shared newer change\n'); const base = await commit(upstream);
  const tree = await git(upstream, 'rev-parse', `${base}^{tree}`);
  const oldSide = await git(upstream, 'commit-tree', tree, '-p', older, '-m', 'old side');
  const truncatedSide = await git(upstream, 'commit-tree', tree, '-p', base, '-m', 'new side');
  const head = await git(upstream, 'commit-tree', tree, '-p', oldSide, '-p', truncatedSide, '-m', 'merge sides');
  await git(upstream, 'update-ref', 'refs/heads/topic', head);
  const root = await temporary(t); await git(root, 'clone', '-q', upstream, '.');
  await writeFile(join(root, '.git', 'shallow'), `${truncatedSide}\n`);
  assert.equal(await git(root, 'merge-base', base, head), older);
  publicPr(t, base, head);
  const calls = await fixtureFetch(t, { 'https://github.com/owner/repo.git': upstream });
  const snapshot = await prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' });
  assert.deepEqual(snapshot.provenance, { base, head, mergeBase: base });
  assert.equal(snapshot.diff, ''); assert.ok((await calls()).length > 0);
});

test('unrelated PR histories reject without fetching arbitrary branch tips', async t => {
  const { root, base } = await repository(t);
  await git(root, 'checkout', '--orphan', 'unrelated'); await writeFile(join(root, 'main.ts'), 'unrelated\n'); const head = await commit(root);
  publicPr(t, base, head); const calls = await fixtureFetch(t, {}, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /no unambiguous common ancestry/);
  assert.equal((await calls()).length, 0);
});

test('shallow ancestry fetches are bounded when the server supplies no additional history', async t => {
  const { root, base: ancestor } = await repository(t);
  await writeFile(join(root, 'main.ts'), 'base\n'); const base = await commit(root);
  await git(root, 'checkout', '-qb', 'topic', ancestor);
  await writeFile(join(root, 'main.ts'), 'head\n'); const head = await commit(root);
  await writeFile(join(root, '.git', 'shallow'), `${base}\n${head}\n`);
  publicPr(t, base, head); const calls = await fixtureFetch(t, {}, false, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /bounded shallow-history fetches/);
  const fetches = await calls(); assert.equal(fetches.length, 6);
  assert.deepEqual(fetches.map(args => args.find(arg => arg.startsWith('--deepen='))),
    ['--deepen=64', '--deepen=64', '--deepen=256', '--deepen=256', '--deepen=1024', '--deepen=1024']);
});

test('deleted fork metadata rejects before any history fetch', async t => {
  const { root, base } = await repository(t); const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ number: 7,
    base: { sha: base, repo: { clone_url: 'https://github.com/owner/repo.git' } }, head: { sha: base, repo: null },
  }));
  const calls = await fixtureFetch(t, {}, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /PR head repository unavailable/);
  assert.equal((await calls()).length, 0);
});

test('a genuine unrelated root merged after the common ancestor is not mistaken for shallow history', async t => {
  const { root, base } = await repository(t); const tree = await git(root, 'rev-parse', `${base}^{tree}`);
  const otherRoot = await git(root, 'commit-tree', tree, '-m', 'independent root');
  const head = await git(root, 'commit-tree', tree, '-p', base, '-p', otherRoot, '-m', 'merge root');
  publicPr(t, base, head); const calls = await fixtureFetch(t, {}, true);
  const snapshot = await prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' });
  assert.deepEqual(snapshot.provenance, { base, head, mergeBase: base }); assert.equal((await calls()).length, 0);
});

test('multiple best merge-bases reject rather than selecting an arbitrary PR scope', async t => {
  const { root, base: ancestor } = await repository(t); const tree = await git(root, 'rev-parse', `${ancestor}^{tree}`);
  const left = await git(root, 'commit-tree', tree, '-p', ancestor, '-m', 'left');
  const right = await git(root, 'commit-tree', tree, '-p', ancestor, '-m', 'right');
  const base = await git(root, 'commit-tree', tree, '-p', left, '-p', right, '-m', 'base');
  const head = await git(root, 'commit-tree', tree, '-p', right, '-p', left, '-m', 'head');
  publicPr(t, base, head); const calls = await fixtureFetch(t, {}, true);
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/7' }), /multiple merge-bases/);
  assert.equal((await calls()).length, 0);
});

test('local capture contains complete staged, unstaged, deleted and untracked changes', async t => {
  const { root, base } = await repository(t);
  await writeFile(join(root, 'removed.ts'), 'removed\n'); await commit(root);
  await writeFile(join(root, 'main.ts'), 'staged\n'); await git(root, 'add', 'main.ts');
  await writeFile(join(root, 'main.ts'), Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n') + '\n');
  const removed = resolve(root, 'removed.ts'); assert.equal(dirname(removed), root); await rm(removed);
  await writeFile(join(root, 'new file.ts'), 'untracked\nno-final-newline');
  const snapshot = await prepareEvidence({ kind: 'local', root });
  assert.match(snapshot.diff, /line 449/); assert.match(snapshot.diff, /deleted file mode/);
  assert.match(snapshot.diff, /new file mode/); assert.match(snapshot.diff, /No newline at end of file/);
  assert.match(snapshot.diff, /untracked/); assert.equal(snapshot.files['removed.ts'], undefined);
  assert.deepEqual(listEvidence(snapshot), ['main.ts', 'new file.ts']);
  assert.equal(readEvidence(snapshot, 'main.ts', 450, 1).lines[0]?.text, 'line 449');
  assert.equal(readEvidence(snapshot, 'main.ts').totalLines, 450);
  assert.notEqual(snapshot.provenance?.head, base);
});

test('range evidence resolves immutable revisions and ignores mutable working tree', async t => {
  const { root, base } = await repository(t);
  await rename(join(root, 'main.ts'), join(root, 'renamed.ts'));
  await writeFile(join(root, 'renamed.ts'), 'head version\n'); const head = await commit(root);
  const snapshot = await prepareEvidence({ kind: 'range', root, base, head: 'HEAD' });
  assert.deepEqual(snapshot.target, { kind: 'range', root, base, head });
  assert.deepEqual(snapshot.provenance, { base, head });
  assert.match(snapshot.diff, /deleted file mode/); assert.match(snapshot.diff, /new file mode/);
  await writeFile(join(root, 'renamed.ts'), 'mutated parent bytes\n');
  assert.equal(readEvidence(snapshot, 'renamed.ts').lines[0]?.text, 'head version');
});

test('snapshot detaches input notes, pack, target and validation clones', async t => {
  const { root } = await repository(t);
  const notes = ['initial context']; const pack = { 'context.md': 'fixed context\n' }; const target = { kind: 'local' as const, root };
  const pending = prepareEvidence(target, { notes, pack });
  notes[0] = 'mutated'; pack['context.md'] = 'mutated'; target.root = '/outside';
  const snapshot = await pending;
  assert.deepEqual(snapshot.notes, ['initial context']); assert.equal(snapshot.files['context.md'], 'fixed context\n');
  const stored = JSON.parse(JSON.stringify(snapshot)); const validated = validateSnapshot(stored);
  stored.files['main.ts'] = 'mutated again'; stored.notes[0] = 'mutated again';
  assert.equal(validated.files['main.ts'], 'export const value = 1;\n');
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.files) && Object.isFrozen(validated.target) && Object.isFrozen(validated.notes) && Object.isFrozen(validated.provenance));
  assert.throws(() => { (validated.files as Record<string, string>)['main.ts'] = 'change'; }, TypeError);
});

test('tampered hash, bytes, metadata, provenance or unknown fields reject', async t => {
  const { root } = await repository(t); const snapshot = await prepareEvidence({ kind: 'local', root });
  for (const mutate of [
    (s: any) => { s.diff += 'tampered'; }, (s: any) => { s.files['main.ts'] += 'tampered'; },
    (s: any) => { s.notes.push('tampered'); }, (s: any) => { s.createdAt += 1; },
    (s: any) => { s.target.root = '/another'; }, (s: any) => { s.provenance.head = '0'.repeat(40); },
    (s: any) => { s.id = 'sha256:' + '0'.repeat(64); }, (s: any) => { s.extra = true; },
  ]) { const copy = JSON.parse(JSON.stringify(snapshot)); mutate(copy); assert.throws(() => validateSnapshot(copy), /Evidence:/); }
  const getter = Object.defineProperty({}, 'id', { get() { throw new Error('should not execute'); }, enumerable: true });
  assert.throws(() => validateSnapshot(getter), /enumerable data/);
});

test('memory-only evidence reads deny traversal, VCS, siblings and unlisted files', async t => {
  const { root } = await repository(t); const snapshot = await prepareEvidence({ kind: 'local', root });
  for (const path of ['../main.ts', '/etc/passwd', 'a/../main.ts', '.git/config', 'outputs/reviewer.json', 'reports/result.md', 'a\\b', 'a//b', '__proto__', 'unknown.ts']) {
    assert.throws(() => readEvidence(snapshot, path), /Evidence:/);
  }
  for (const [offset, limit] of [[0, 1], [-1, 1], [1.5, 1], [1, 0], [1, 2001]]) assert.throws(() => readEvidence(snapshot, 'main.ts', offset, limit), /line range/);
  const file = resolve(root, 'main.ts'); assert.equal(dirname(file), root); await rm(file);
  assert.equal(readEvidence(snapshot, 'main.ts').lines[0]?.number, 1);
});

test('unchanged credential files are hidden, changed ones reject complete preparation', async t => {
  const { root } = await repository(t);
  await writeFile(join(root, '.env'), 'private config'); await commit(root);
  const snapshot = await prepareEvidence({ kind: 'local', root }); assert.equal(snapshot.files['.env'], undefined);
  await writeFile(join(root, '.env'), 'changed private config');
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /restricted evidence path/);
});

test('pack cannot escape, expose credentials, sibling artifacts or override repository bytes', async t => {
  const { root } = await repository(t);
  for (const path of ['../escape', '.git/config', '.dsh/session', '.env', 'outputs/result', 'secret.pem', 'a//b', '__proto__']) {
    await assert.rejects(prepareEvidence({ kind: 'local', root }, { pack: Object.fromEntries([[path, 'context']]) }), /Evidence:/);
  }
  await assert.rejects(prepareEvidence({ kind: 'local', root }, { pack: { 'main.ts': 'replacement' } }), /may not replace/);
  await assert.rejects(prepareEvidence({ kind: 'local', root }, { notes: ['-----BEGIN PRIVATE KEY-----'] }), /credential-like/);
  await assert.rejects(prepareEvidence({ kind: 'local', root }, { pack: { 'context.md': 'access_token=abcdefghijklmnopqrstuvwxyz012345' } }), /credential-like/);
});

test('binary new files and deleted binary changes reject rather than truncate', async t => {
  const { root, base } = await repository(t);
  await writeFile(join(root, 'binary.bin'), Buffer.from([1, 0, 255]));
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /binary/);
  const binaryHead = await commit(root);
  const path = resolve(root, 'binary.bin'); assert.equal(dirname(path), root); await rm(path); const head = await commit(root);
  await assert.rejects(prepareEvidence({ kind: 'range', root, base: binaryHead, head }), /binary/);
  await assert.rejects(prepareEvidence({ kind: 'range', root, base, head: binaryHead }), /binary/);
});

test('non-UTF-8 files and oversized evidence fail explicitly', async t => {
  const { root } = await repository(t);
  await writeFile(join(root, 'bad.txt'), Buffer.from([255, 254]));
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /UTF-8/);
  const bad = resolve(root, 'bad.txt'); assert.equal(dirname(bad), root); await rm(bad);
  await writeFile(join(root, 'large.txt'), 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /byte budget/);
});

test('file and ancestor symlinks, including deleted revision symlinks, fail closed', async t => {
  const { root, base } = await repository(t); const outside = await temporary(t);
  await writeFile(join(outside, 'private.txt'), 'outside bytes');
  await symlink(join(outside, 'private.txt'), join(root, 'link.txt'));
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /symlink/);
  const linkHead = await commit(root);
  const link = resolve(root, 'link.txt'); assert.equal(dirname(link), root); await rm(link); const head = await commit(root);
  await assert.rejects(prepareEvidence({ kind: 'range', root, base: linkHead, head }), /symlink/);
  await assert.rejects(prepareEvidence({ kind: 'range', root, base, head: linkHead }), /symlink/);
  await mkdir(join(root, 'dir')); await writeFile(join(root, 'dir', 'file.txt'), 'inside'); await commit(root);
  const dir = resolve(root, 'dir'); assert.equal(dirname(dir), root); await rm(dir, { recursive: true }); await symlink(outside, dir);
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /symlink|ancestor/);
});

test('unsafe revisions and non-top-level roots reject without shell evaluation', async t => {
  const { root, base } = await repository(t);
  for (const ref of ['--help', 'HEAD; echo leak', '', 'HEAD\n']) await assert.rejects(prepareEvidence({ kind: 'range', root, base, head: ref }), /unsafe revision/);
  await mkdir(join(root, 'subdirectory'));
  await assert.rejects(prepareEvidence({ kind: 'local', root: join(root, 'subdirectory') }), /top-level/);
});

for (const kind of ['github', 'gitcode'] as const) {
  test(`${kind} public PR metadata freezes base/head provenance using host-only requests`, async t => {
    const { root, base } = await repository(t); await writeFile(join(root, 'main.ts'), 'remote version\n'); const head = await commit(root);
    const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      requests++; assert.equal(String(url), kind === 'github' ? 'https://api.github.com/repos/owner/repo/pulls/7' : 'https://api.gitcode.com/api/v5/repos/owner/repo/pulls/7');
      assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).has('Authorization'), false);
      const remote = `https://${kind === 'github' ? 'github.com' : 'gitcode.com'}/owner/repo.git`;
      return new Response(JSON.stringify({ number: 7, base: { sha: base, repo: { clone_url: remote, html_url: remote } }, head: { sha: head, repo: { clone_url: remote, html_url: remote } } }));
    };
    const snapshot = await prepareEvidence({ kind, root, url: `https://${kind === 'github' ? 'github.com/owner/repo/pull' : 'gitcode.com/owner/repo/pulls'}/7` });
    assert.deepEqual(snapshot.provenance, { base, head, mergeBase: base }); assert.equal(snapshot.files['main.ts'], 'remote version\n');
    assert.equal(snapshot.target.kind, kind); assert.equal(requests, 1);
    if (snapshot.target.kind === 'gitcode') assert.match(snapshot.target.url, /merge_requests\/7$/);
  });
}

test('PR URLs, denied metadata, wrong identity and unsafe repository hosts fail closed', async t => {
  const { root, base } = await repository(t); const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let requests = 0; globalThis.fetch = async () => { requests++; return new Response('{}', { status: 403 }); };
  for (const url of ['https://evil.invalid/owner/repo/pull/1', 'https://user:secret@github.com/owner/repo/pull/1', 'https://github.com/owner/repo/pull/1?token=private', 'https://github.com/owner/repo/issues/1', 'http://github.com/owner/repo/pull/1']) {
    await assert.rejects(prepareEvidence({ kind: 'github', root, url }), /PR URL/);
  }
  assert.equal(requests, 0);
  await assert.rejects(prepareEvidence({ kind: 'gitcode', root, url: 'https://gitcode.com/owner/repo/merge_requests/1' }), /HTTP 403/);
  globalThis.fetch = async () => new Response(JSON.stringify({ number: 2 }));
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/1' }), /identity mismatch/);
  globalThis.fetch = async () => new Response(JSON.stringify({ number: 1, base: { sha: base, repo: { clone_url: 'https://evil.invalid/owner/repo.git' } } }));
  await assert.rejects(prepareEvidence({ kind: 'github', root, url: 'https://github.com/owner/repo/pull/1' }), /unsafe PR repository/);
});

test('configured clean/process filters and remote rewrites reject before execution', async t => {
  const { root } = await repository(t); const marker = join(root, 'executed');
  await git(root, 'config', 'filter.evil.clean', `touch ${marker}`);
  await writeFile(join(root, '.gitattributes'), '*.ts filter=evil\n');
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /command filters/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await git(root, 'config', '--unset', 'filter.evil.clean');
  await git(root, 'config', 'url.https://evil.invalid/.insteadOf', 'https://github.com/');
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /remote rewrites/);
});

test('pack cannot replace deleted repository paths', async t => {
  const { root, base } = await repository(t);
  const path = resolve(root, 'main.ts'); assert.equal(dirname(path), root); await rm(path); const head = await commit(root);
  await assert.rejects(prepareEvidence({ kind: 'range', root, base, head }, { pack: { 'main.ts': 'misleading replacement' } }), /may not replace/);
});

test('local before/after capture detects deterministic parent mutation', async t => {
  const { root } = await repository(t); const scratch = await temporary(t);
  const realGit = (await exec('which', ['git'])).stdout.trim(); assert.ok(isAbsolute(realGit));
  const wrapper = join(scratch, 'git'); const counter = join(scratch, 'counter');
  await writeFile(wrapper, `#!${process.execPath}\nconst fs = require('node:fs'); const cp = require('node:child_process');\nconst args=process.argv.slice(2); if(args.includes('diff')) { let n=0; try { n=Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')); } catch {} n++; fs.writeFileSync(${JSON.stringify(counter)},String(n)); if(n===3) fs.writeFileSync(${JSON.stringify(join(root, 'main.ts'))},'changed between captures\\n'); }\nconst child=cp.spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'}); process.exit(child.status??1);\n`);
  await chmod(wrapper, 0o755);
  const path = process.env.PATH; process.env.PATH = `${scratch}:${path ?? ''}`; t.after(() => { process.env.PATH = path; });
  await assert.rejects(prepareEvidence({ kind: 'local', root }), /workspace changed during capture/);
  assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), 'changed between captures\n');
});
