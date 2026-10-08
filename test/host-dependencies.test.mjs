import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('native runtime imports are Host peers rather than profile-local package dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const imports = new Set();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await visit(url);
      else if (entry.name.endsWith('.ts')) {
        for (const match of (await readFile(url, 'utf8')).matchAll(/(?:from\s+|import\s*)['"](@deepseek-ai\/[^/'"]+)/g)) imports.add(match[1]);
      }
    }
  }
  await visit(new URL('../src/', import.meta.url));
  assert.ok(imports.has('@deepseek-ai/dsh-tools'));
  for (const name of imports) {
    assert.equal(manifest.dependencies?.[name], undefined, `${name} must not shadow the installed Host runtime`);
    assert.ok(manifest.peerDependencies[name], `${name} must declare Host compatibility`);
    assert.equal(manifest.devDependencies[name], manifest.peerDependencies[name], `${name} must remain available for isolated development checks`);
  }
});
