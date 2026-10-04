import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPlugins } from '../scripts/lib/plugins.mjs';
import { scaffoldPlugin } from '../scripts/new-plugin.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
async function scratch(t) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'dsh-scaffold-boundary-')));
  t.after(async () => {
    assert.equal(resolve(root), root); assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('dsh-scaffold-boundary-')); assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['plugins', 'src/plugins', 'test'].map(path => mkdir(join(root, path), { recursive: true })));
  await copyFile(join(repository, 'package.json'), join(root, 'package.json'));
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n');
  return root;
}

test('flat patch validation rejects group carriers that defeat disabled:true in the native Loader', async t => {
  const root = await scratch(t);
  await scaffoldPlugin(root, 'future-review');
  const row = { id: 'future-review', name: 'dsh-codeasier/plugins/future-review', disabled: true, group: true };
  const standalone = join(root, 'plugins/future-review/cordis.patch.yml');
  await writeFile(standalone, JSON.stringify([{ insert: [row] }]));
  await assert.rejects(inspectPlugins(root), /group/);
  await writeFile(standalone, JSON.stringify([{ insert: [{ ...row, group: undefined }] }]));
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [row] }]));
  await assert.rejects(inspectPlugins(root), /group/);
});

test('scaffold TUI adapters cannot activate before implementation', async t => {
  const root = await scratch(t);
  await scaffoldPlugin(root, 'future-review');
  const path = join(root, 'plugins/future-review/plugin.json');
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  descriptor.tui = { entry: 'dsh-codeasier/plugins/future-review/tui', patch: 'plugins/future-review/tui.patch.yml' };
  await writeFile(path, JSON.stringify(descriptor));
  await writeFile(join(root, 'src/plugins/future-review/tui.ts'), 'export const name = "future-review-tui";\n');
  const patch = join(root, descriptor.tui.patch);
  const row = { id: 'future-review-optional-tui', name: descriptor.tui.entry };
  await writeFile(patch, JSON.stringify([{ insert: [row] }]));
  await assert.rejects(inspectPlugins(root), /Scaffold TUI must be disabled/);
  await writeFile(patch, JSON.stringify([{ insert: [{ ...row, disabled: true }] }]));
  assert.equal((await inspectPlugins(root))[0].tui.entry, descriptor.tui.entry);
});

test('scaffolder rejects reserved optional-adapter IDs before creating output', async t => {
  const root = await scratch(t);
  await scaffoldPlugin(root, 'future-review');
  const path = join(root, 'plugins/future-review/plugin.json');
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  descriptor.tui = { entry: 'dsh-codeasier/plugins/future-review/tui', patch: 'plugins/future-review/tui.patch.yml' };
  await writeFile(path, JSON.stringify(descriptor));
  await writeFile(join(root, 'src/plugins/future-review/tui.ts'), 'export const name = "future-review-tui";\n');
  await writeFile(join(root, descriptor.tui.patch), JSON.stringify([{ insert: [{ id: 'future-review-optional-tui', name: descriptor.tui.entry, disabled: true }] }]));
  await assert.rejects(scaffoldPlugin(root, 'future-review-optional-tui'), /reserved.*TUI/);
  await assert.rejects(lstat(join(root, 'plugins/future-review-optional-tui')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(root, 'src/plugins/future-review-optional-tui')), { code: 'ENOENT' });
});

test('completed new plugins retain opt-in defaults in standalone and aggregate patches', async t => {
  const root = await scratch(t);
  await scaffoldPlugin(root, 'future-review');
  const path = join(root, 'plugins/future-review/plugin.json');
  const descriptor = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...descriptor, status: 'implemented' }));
  const row = { id: descriptor.id, name: descriptor.entry, disabled: true };
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [row] }]));
  assert.equal((await inspectPlugins(root))[0].defaultEnabled, false);
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ ...row, disabled: false }] }]));
  await assert.rejects(inspectPlugins(root), /Aggregate default enablement mismatch/);
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [row] }]));
  await writeFile(join(root, descriptor.patch), JSON.stringify([{ insert: [{ ...row, disabled: false }] }]));
  await assert.rejects(inspectPlugins(root), /Standalone default enablement mismatch/);
});
