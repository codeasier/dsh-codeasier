import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedPath, inspectPlugins, pluginId, readJson } from './lib/plugins.mjs';

async function absent(path) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Refusing to overwrite existing path: ${path}`);
}

/** Creates local files only; never installs, edits a profile, or enables a plugin. */
export async function scaffoldPlugin(inputRoot, rawId, kind = 'native') {
  const id = pluginId.parse(rawId);
  if (!['native', 'skill'].includes(kind)) throw new Error('Kind must be native or skill');
  const root = await realpath(inputRoot);
  const pkg = await readJson(root, 'package.json');
  await checkedPath(root, 'plugins', true);
  const resourceDir = join(root, 'plugins', id);
  const sourceDir = join(root, 'src/plugins', id);
  const testPath = join(root, 'test', `${id}.test.ts`);
  // Preflight all destinations before creating anything; lstat catches broken symlinks.
  await absent(resourceDir);
  if (kind === 'native') {
    await checkedPath(root, 'src/plugins', true);
    await checkedPath(root, 'test', true);
    await absent(sourceDir); await absent(testPath);
  }
  const catalog = await inspectPlugins(root);
  if (kind === 'native' && catalog.some(plugin => plugin.kind === 'native' && plugin.tui && `${plugin.id}-optional-tui` === id)) {
    throw new Error(`Plugin id is reserved by an existing optional TUI adapter: ${id}`);
  }
  await mkdir(resourceDir);
  const descriptor = { schemaVersion: 1, id, kind, status: 'scaffold', description: `TODO: describe ${id}`,
    ...(kind === 'native' ? { entry: `${pkg.name}/plugins/${id}`, patch: `plugins/${id}/cordis.patch.yml` }
      : { skill: `plugins/${id}/SKILL.md` }) };
  const files = [[join(resourceDir, 'plugin.json'), `${JSON.stringify(descriptor, null, 2)}\n`],
    [join(resourceDir, 'README.md'), `# ${id}\n\n**Scaffold only; migration is not implemented.**\n\n${kind === 'native'
      ? `Entry: \`${descriptor.entry}\`. Its standalone patch is disabled. It is not in the aggregate bundle.\n\nImplement native Host behavior and contract tests before setting status to implemented. Keep \`disabled: true\` in both the standalone patch and the new aggregate Host row. Enable only through an explicit user overlay after verifying configuration and prerequisites.`
      : 'SKILL.md is an instruction asset, not a Cordis backend. Rewrite runtime-specific instructions and validate its DSH prerequisites before marking it implemented. Native skill discovery/installation is a separate explicit operation.'}\n\nRecord upstream URL/revision, retained attribution/license notices and migration gaps here. See ../../docs/plugin-development.md.\n`]];
  if (kind === 'native') {
    await mkdir(sourceDir);
    files.push([join(sourceDir, 'index.ts'), `import type { Context } from '@deepseek-ai/cordis';\nimport z from '@deepseek-ai/schemastery';\n\nexport const name = '${id}';\nexport const inject: string[] = []; // Declare required native services after porting.\nexport const Config = z.object({});\n\nexport async function apply(_ctx: Context): Promise<void> {\n  // Fail closed: a generated template must never pretend to provide migrated behavior.\n  throw new Error('${id} is an unimplemented plugin scaffold');\n}\n`]);
    files.push([join(resourceDir, 'cordis.patch.yml'), `# Scaffold only; enable explicitly after implementing native behavior.\n- insert:\n    - id: ${id}\n      name: ${descriptor.entry}\n      disabled: true\n`]);
    files.push([testPath, `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { name } from '../src/plugins/${id}/index.js';\n\ntest('${id} has a stable plugin identity', () => assert.equal(name, '${id}'));\ntest.todo('${id}: port behavior and test native authorization, disposal and unavailable capabilities');\n`]);
  } else {
    files.push([join(resourceDir, 'SKILL.md'), `---\nname: ${id}\ndescription: TODO migrate ${id} instructions to DSH.\n---\n\n# ${id}\n\nScaffold only. Replace this text with the portable task instructions.\n\n- Name required DSH tools/services explicitly; do not retain OpenCode tool or config assumptions.\n- Ask before paid model work, installation, publication or destructive effects.\n- If behavior requires enforced execution, cancellation or recovery, implement a native plugin instead.\n`]);
  }
  for (const [path, content] of files) await writeFile(path, content, { flag: 'wx' });
  return files.map(([path]) => path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [id, option, kind, ...extra] = process.argv.slice(2);
    if (!id || (option !== undefined && option !== '--kind') || (option && !kind) || extra.length) throw new Error('Usage: pnpm plugin:new <kebab-id> [--kind native|skill]');
    const files = await scaffoldPlugin(fileURLToPath(new URL('../', import.meta.url)), id, kind);
    console.log(`Created ${files.length} local files. Scaffold only; no plugin was enabled or installed.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
