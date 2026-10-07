import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

// Only existing cases run in the children, so this regression cannot spawn itself.
const cases = [
  ['lifecycle-races.test.ts', ['disposal cancels a pending native approval and admits zero reviewers']],
  ['cross-review-audit.test.ts', [
    'genuine offline native run audits after normal child release with no extra model requests',
    'report comparison is bound to one revision; concurrent service reads never invent a violation',
  ]],
  ['service.test.ts', [
    'actual Host mounts without TUI and registers native tools and human commands',
    'plain DSH no-TUI review completes from events without status-driven scheduling',
  ]],
];

test('review fixtures ignore malformed external HOME and restore HOME after repeated fixtures', { timeout: 90_000 }, async t => {
  const temporary = await realpath(tmpdir()); const home = await realpath(await mkdtemp(join(temporary, 'dsh-poisoned-home-')));
  try {
    await mkdir(join(home, '.dsh'));
    const poisoned = join(home, '.dsh', 'cross-review.json'); await writeFile(poisoned, '{');
    for (const [file, names] of cases) {
      const probe = join(home, `${file}.mjs`);
      // node:test runs afterEach before t.after: check before the next test and after the suite instead.
      await writeFile(probe, `import assert from 'node:assert/strict';\nimport { beforeEach, after } from 'node:test';\nconst home = process.env.HOME;\nconst restored = () => assert.equal(process.env.HOME, home, 'test leaked HOME');\nbeforeEach(restored); after(restored);\nawait import(${JSON.stringify(new URL(file, import.meta.url).href)});\n`);
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.NODE_TEST_CONTEXT; // Nested node --test otherwise skips running its files.
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-name-pattern', `^(?:${names.join('|')})$`, probe], {
        cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 30_000,
      });
      t.diagnostic(`${file}: child exit ${result.status}; selected cases ${names.length}`);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`# pass ${names.length}\\b`));
      for (const name of names) assert.ok(result.stdout.includes(`# Subtest: ${name}\n`), `selected case did not run: ${name}`);
      assert.equal(await readFile(poisoned, 'utf8'), '{', 'external configuration must remain untouched');
    }
  } finally {
    assert.equal(dirname(home), temporary); assert.ok(basename(home).startsWith('dsh-poisoned-home-')); assert.equal(await realpath(home), home);
    await rm(home, { recursive: true, force: true });
  }
});
