import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { inspectPlugins, exportedPath } from '../scripts/lib/plugins.mjs';
import { scaffoldPlugin } from '../scripts/new-plugin.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
async function scratch(t) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'dsh-plugin-repo-')));
  t.after(async () => {
    assert.equal(resolve(root), root); assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('dsh-plugin-repo-')); assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['plugins', 'src/plugins', 'test'].map(path => mkdir(join(root, path), { recursive: true })));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n');
  return root;
}

test('collection descriptors and native patch identities are canonical; default remains legacy-compatible Host-only', async () => {
  const plugins = await inspectPlugins(repository);
  const crossReview = plugins.find(plugin => plugin.id === 'cross-review');
  assert.ok(crossReview, 'The legacy cross-review identity must remain in the collection');
  assert.equal(crossReview.kind, 'native'); assert.equal(crossReview.status, 'implemented');
  assert.equal(crossReview.entry, 'dsh-codeasier/plugins/cross-review');
  const source = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(source, /id: cross-review\s+name: dsh-codeasier(?:\s|$)/);
  assert.doesNotMatch(source, /optional-tui/);
});

test('canonical review modules and compatibility wrappers share exact implementation identity', async () => {
  const pairs = [['host', 'index'], ['tui', 'tui'], ['protocol', 'protocol'], ['store', 'store'], ['service', 'service']];
  for (const [legacyName, canonicalName] of pairs) {
    const legacy = await import(`../src/${legacyName}.ts`);
    const canonical = await import(`../src/plugins/cross-review/${canonicalName}.ts`);
    assert.deepEqual(Object.keys(legacy), Object.keys(canonical));
    for (const key of Object.keys(legacy)) assert.equal(legacy[key], canonical[key]);
  }
});

test('generic export paths select plugin entries, TUI/protocol and resources without exposing ordinary internal modules', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [specifier, path] of [
    ['dsh-codeasier/plugins/future-review', './dist/plugins/future-review/index.js'],
    ['dsh-codeasier/plugins/future-review/tui', './dist/plugins/future-review/tui.js'],
    ['dsh-codeasier/plugins/cross-review/protocol', './dist/plugins/cross-review/protocol.js'],
    ['dsh-codeasier/plugins/cross-review/plugin.json', './plugins/cross-review/plugin.json'],
    ['dsh-codeasier/plugins/cross-review/cordis.patch.yml', './plugins/cross-review/cordis.patch.yml'],
    ['dsh-codeasier/plugins/future-skill/SKILL.md', './plugins/future-skill/SKILL.md'],
  ]) assert.equal(exportedPath(pkg, specifier), path);
  assert.equal(exportedPath(pkg, 'dsh-codeasier'), './dist/host.js');
  // Node wildcards capture slashes, but there are no nested internal index files.
  assert.notEqual(exportedPath(pkg, 'dsh-codeasier/plugins/cross-review/service'), './dist/plugins/cross-review/service.js');
});

test('native scaffold is independently exported, disabled and not added to aggregate or existing config', async t => {
  const root = await scratch(t);
  const original = await readFile(join(root, 'package.json'), 'utf8');
  const files = await scaffoldPlugin(root, 'session-review');
  assert.equal(files.length, 5);
  const [plugin] = await inspectPlugins(root);
  assert.equal(plugin.status, 'scaffold'); assert.equal(plugin.kind, 'native'); assert.equal(plugin.defaultEnabled, false);
  assert.match(await readFile(join(root, plugin.patch), 'utf8'), /disabled: true/);
  assert.match(await readFile(join(root, 'src/plugins/session-review/index.ts'), 'utf8'), /unimplemented plugin scaffold/);
  assert.match(await readFile(join(root, 'plugins/session-review/README.md'), 'utf8'), /keep.*disabled: true/i);
  assert.equal(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), '[]\n');
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), original);
  await assert.rejects(scaffoldPlugin(root, 'session-review'), /Refusing to overwrite/);
});

test('skill scaffold is an instruction asset without any native activation or install', async t => {
  const root = await scratch(t);
  const files = await scaffoldPlugin(root, 'handoff-notes', 'skill');
  assert.equal(files.length, 3);
  const [plugin] = await inspectPlugins(root);
  assert.equal(plugin.kind, 'skill'); assert.equal(plugin.skill, 'plugins/handoff-notes/SKILL.md');
  await assert.rejects(lstat(join(root, 'src/plugins/handoff-notes')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(root, 'plugins/handoff-notes/cordis.patch.yml')), { code: 'ENOENT' });
});

test('scaffolding rejects invalid IDs, unknown kinds, destination collisions and symlinked parents before writing', async t => {
  const root = await scratch(t);
  for (const id of ['../escape', '/absolute', 'with space', 'bad_id', 'UPPER', '-flag', 'constructor', 'prototype']) {
    await assert.rejects(scaffoldPlugin(root, id));
  }
  await assert.rejects(scaffoldPlugin(root, 'valid-name', 'opencode'), /Kind must/);
  await writeFile(join(root, 'test/collides.test.ts'), 'owned\n');
  await assert.rejects(scaffoldPlugin(root, 'collides'), /Refusing to overwrite/);
  await assert.rejects(lstat(join(root, 'plugins/collides')), { code: 'ENOENT' });
  await symlink(join(root, 'missing-target'), join(root, 'plugins/broken-link'));
  await assert.rejects(scaffoldPlugin(root, 'broken-link'), /Refusing to overwrite/);
  await mkdir(join(root, 'elsewhere'));
  await symlink(join(root, 'elsewhere'), join(root, 'plugins/linked-plugin'));
  await assert.rejects(inspectPlugins(root), /Symlink paths/);
});

test('collection validator rejects descriptor/path drift, enabled scaffolds and duplicate aggregate IDs', async t => {
  const root = await scratch(t);
  await scaffoldPlugin(root, 'first-plugin');
  const patch = join(root, 'plugins/first-plugin/cordis.patch.yml');
  const originalPatch = await readFile(patch, 'utf8');
  await writeFile(patch, originalPatch.replace('disabled: true', 'disabled: false'));
  await assert.rejects(inspectPlugins(root), /Scaffold must be disabled/);
  await writeFile(patch, originalPatch);
  const row = { id: 'first-plugin', name: 'dsh-codeasier/plugins/first-plugin', disabled: true };
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [row, row] }]));
  await assert.rejects(inspectPlugins(root), /Duplicate aggregate loader id/);
  await writeFile(join(root, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ ...row, disabled: false }] }]));
  await assert.rejects(inspectPlugins(root), /Aggregate enabled scaffold/);
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n');
  const descriptorPath = join(root, 'plugins/first-plugin/plugin.json');
  const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
  await writeFile(descriptorPath, JSON.stringify({ ...descriptor, patch: '../../outside' }));
  await assert.rejects(inspectPlugins(root), /Noncanonical native entry/);
});

test('native Loader skips disabled imports entirely and disposes only the selected activation', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Loader, {});
  const loader = ctx.loader;
  await loader.create({ id: 'disabled', name: 'not-installed-do-not-import', disabled: true });
  assert.equal([...loader.entries()].find(entry => entry.options.id === 'disabled').fiber, undefined);
  let mounts = 0, disposals = 0;
  const selected = { name: 'fixture-plugin', apply() { mounts++; return () => { disposals++; }; } };
  loader.builtins['fixture-plugin'] = selected;
  await loader.create({ id: 'selected', name: 'cordis:fixture-plugin' });
  assert.equal(mounts, 1); assert.equal(disposals, 0);
  await [...loader.entries()].find(entry => entry.options.id === 'selected').update({ disabled: true });
  assert.equal(mounts, 1); assert.equal(disposals, 1);
});

test('native patch composition preserves legacy guarded overlays and replaces config as a whole', async () => {
  // Resolve a public installed dependency from its owning package, not a private source path.
  const require = createRequire(import.meta.url);
  const dshRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
  const boot = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { parse } = await import('yaml');
  const defaults = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
  const layers = [defaults, [{ id: 'cross-review', name: pkg.name, config: { root: '/private/state', review: { reviewers: [] } } }],
    [{ id: 'cross-review', config: { root: '/replaced' } }]];
  const before = structuredClone(layers);
  const warnings = [];
  const rows = boot.composeEntries(layers, value => warnings.push(value));
  assert.deepEqual(layers, before); assert.deepEqual(warnings, []);
  assert.equal(rows[0].name, 'dsh-codeasier'); assert.equal(rows[0].id, 'cross-review');
  assert.deepEqual(rows[0].config, { root: '/replaced' });
});
