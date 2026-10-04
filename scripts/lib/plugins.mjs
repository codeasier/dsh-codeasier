import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export const pluginId = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .refine(id => !['constructor', 'prototype'].includes(id), 'Reserved plugin id');
const text = z.string().trim().min(1);
const base = { schemaVersion: z.literal(1), id: pluginId, status: z.enum(['implemented', 'scaffold']), description: text };
export const descriptorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('native'), entry: text, patch: text, defaultEnabled: z.boolean().default(false), legacyEntries: z.array(text).optional(),
    tui: z.strictObject({ entry: text, patch: text }).optional() }),
  z.strictObject({ ...base, kind: z.literal('skill'), skill: text }),
]);

/** Repository tooling only: this metadata is NOT a DSH Component manifest. */
export async function checkedPath(root, relative, directory = false) {
  const path = resolve(root, relative);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`Path escapes repository: ${relative}`);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || await realpath(path) !== path) throw new Error(`Symlink paths are not supported: ${relative}`);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Unexpected path type: ${relative}`);
  return path;
}

export async function readJson(root, relative) {
  return JSON.parse(await readFile(await checkedPath(root, relative), 'utf8'));
}

/** Match Node's longest-pattern rule for the repository's explicit export maps. */
export function exportedPath(pkg, specifier, condition = 'default') {
  if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) throw new Error(`Foreign package entry: ${specifier}`);
  const key = specifier === pkg.name ? '.' : `.${specifier.slice(pkg.name.length)}`;
  let value = pkg.exports[key];
  if (value === undefined) {
    const patterns = Object.keys(pkg.exports).filter(pattern => pattern.includes('*')).sort((a, b) => {
      return b.indexOf('*') - a.indexOf('*') || b.length - a.length;
    });
    for (const pattern of patterns) {
      const [prefix, suffix] = pattern.split('*');
      if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) continue;
      const capture = key.slice(prefix.length, key.length - suffix.length);
      const target = pkg.exports[pattern];
      value = typeof target === 'string' ? target.replace('*', capture)
        : Object.fromEntries(Object.entries(target).map(([name, path]) => [name, path.replace('*', capture)]));
      break;
    }
  }
  const path = typeof value === 'string' ? value : value?.[condition];
  if (typeof path !== 'string' || !path.startsWith('./')) throw new Error(`Missing ${condition} export: ${specifier}`);
  return path;
}

// group:true has special Loader activation semantics and bypasses disabled:true.
// Collection patches only contain ordinary flat entries, never group carriers.
const flatEntrySchema = z.strictObject({ id: pluginId, name: text, disabled: z.boolean().optional(),
  config: z.unknown().optional(), inject: z.array(text).optional() });

async function singleEntry(root, patch, id, name) {
  const document = parse(await readFile(await checkedPath(root, patch), 'utf8'));
  if (!Array.isArray(document) || document.length !== 1 || Object.keys(document[0] ?? {}).join() !== 'insert'
    || !Array.isArray(document[0].insert) || document[0].insert.length !== 1) throw new Error(`Expected single insert patch: ${patch}`);
  const entry = flatEntrySchema.parse(document[0].insert[0]);
  if (entry.id !== id || entry.name !== name) throw new Error(`Patch entry mismatch: ${patch}`);
  return entry;
}

export async function inspectPlugins(inputRoot, { built = false } = {}) {
  const root = await realpath(inputRoot);
  const pkg = await readJson(root, 'package.json');
  const directory = await checkedPath(root, 'plugins', true);
  const descriptors = [];
  const identities = new Set();
  for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!child.isDirectory() && !child.isSymbolicLink()) continue;
    const id = pluginId.parse(child.name);
    await checkedPath(root, `plugins/${id}`, true);
    const descriptor = descriptorSchema.parse(await readJson(root, `plugins/${id}/plugin.json`));
    if (descriptor.id !== id) throw new Error(`Descriptor id mismatch: ${id}`);
    await checkedPath(root, `plugins/${id}/README.md`);
    // Resources must also be included in the local tarball allowlist.
    if (!pkg.files.includes('plugins')) throw new Error('Plugin resources are missing from package files');
    if (descriptor.kind === 'native') {
      const entry = `${pkg.name}/plugins/${id}`;
      const patch = `plugins/${id}/cordis.patch.yml`;
      if (descriptor.entry !== entry || descriptor.patch !== patch) throw new Error(`Noncanonical native entry: ${id}`);
      await checkedPath(root, `src/plugins/${id}/index.ts`);
      if (exportedPath(pkg, entry) !== `./dist/plugins/${id}/index.js`
        || exportedPath(pkg, entry, 'types') !== `./dist/plugins/${id}/index.d.ts`) throw new Error(`Wrong native exports: ${id}`);
      if (exportedPath(pkg, `${pkg.name}/${patch}`) !== `./${patch}`) throw new Error(`Missing patch export: ${id}`);
      const host = await singleEntry(root, patch, id, entry);
      if (descriptor.status === 'scaffold' && (descriptor.defaultEnabled || host.disabled !== true)) throw new Error(`Scaffold must be disabled: ${id}`);
      if ((host.disabled !== true) !== descriptor.defaultEnabled) throw new Error(`Standalone default enablement mismatch: ${id}`);
      if (identities.has(id)) throw new Error(`Duplicate loader identity: ${id}`);
      identities.add(id);
      for (const alias of descriptor.legacyEntries ?? []) {
        for (const condition of ['default', 'types']) {
          const path = exportedPath(pkg, alias, condition);
          if (built) await checkedPath(root, path);
        }
      }
      if (built) for (const condition of ['default', 'types']) await checkedPath(root, exportedPath(pkg, entry, condition));
      if (descriptor.tui) {
        const tuiId = `${id}-optional-tui`;
        if (identities.has(tuiId)) throw new Error(`Duplicate loader identity: ${tuiId}`);
        identities.add(tuiId);
        if (descriptor.tui.entry !== `${entry}/tui` || descriptor.tui.patch !== `plugins/${id}/tui.patch.yml`) throw new Error(`Noncanonical TUI entry: ${id}`);
        await checkedPath(root, `src/plugins/${id}/tui.ts`);
        const adapter = await singleEntry(root, descriptor.tui.patch, tuiId, descriptor.tui.entry);
        if (descriptor.status === 'scaffold' && adapter.disabled !== true) throw new Error(`Scaffold TUI must be disabled: ${id}`);
        if (exportedPath(pkg, `${pkg.name}/${descriptor.tui.patch}`) !== `./${descriptor.tui.patch}`) throw new Error(`Missing TUI patch export: ${id}`);
        for (const condition of ['default', 'types']) {
          const path = exportedPath(pkg, descriptor.tui.entry, condition);
          const extension = condition === 'types' ? 'd.ts' : 'js';
          if (path !== `./dist/plugins/${id}/tui.${extension}`) throw new Error(`Wrong TUI export: ${id}`);
          if (built) await checkedPath(root, path);
        }
      }
    } else {
      if (descriptor.skill !== `plugins/${id}/SKILL.md`) throw new Error(`Noncanonical skill asset: ${id}`);
      const source = await readFile(await checkedPath(root, descriptor.skill), 'utf8');
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
      const header = frontmatter && parse(frontmatter[1]);
      if (!header || header.name !== id || typeof header.description !== 'string' || !header.description.trim()) throw new Error(`Invalid skill header: ${id}`);
      if (exportedPath(pkg, `${pkg.name}/${descriptor.skill}`) !== `./${descriptor.skill}`) throw new Error(`Missing skill asset export: ${id}`);
    }
    descriptors.push(descriptor);
  }
  const aggregate = parse(await readFile(await checkedPath(root, 'cordis.patch.yml'), 'utf8'));
  if (!Array.isArray(aggregate)) throw new Error('Aggregate patch must be an array');
  const included = new Set();
  for (const operation of aggregate) {
    if (Object.keys(operation ?? {}).join() !== 'insert' || !Array.isArray(operation.insert)) throw new Error('Aggregate may only insert flat plugin entries');
    for (const rawEntry of operation.insert) {
      const entry = flatEntrySchema.parse(rawEntry);
      if (included.has(entry.id)) throw new Error(`Duplicate aggregate loader id: ${entry.id}`);
      included.add(entry.id);
      const descriptor = descriptors.find(plugin => plugin.kind === 'native' && plugin.id === entry.id);
      if (!descriptor || ![descriptor.entry, ...(descriptor.legacyEntries ?? [])].includes(entry.name)) throw new Error(`Unknown aggregate plugin entry: ${entry.id}`);
      if (descriptor.status === 'scaffold' && entry.disabled !== true) throw new Error(`Aggregate enabled scaffold: ${entry.id}`);
      if ((entry.disabled !== true) !== descriptor.defaultEnabled) throw new Error(`Aggregate default enablement mismatch: ${entry.id}`);
    }
  }
  for (const descriptor of descriptors) {
    if (descriptor.kind === 'native' && descriptor.status === 'implemented' && !included.has(descriptor.id)) throw new Error(`Implemented Host missing from aggregate: ${descriptor.id}`);
  }
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('The default bundle must select only the aggregate patch');
  return descriptors;
}
