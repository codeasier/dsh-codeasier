import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repository = fileURLToPath(new URL('../', import.meta.url));
const english = ['README.md', 'docs/README.md', 'docs/architecture.md', 'docs/plugin-development.md',
  'docs/contracts.md', 'docs/tui-admission-gap.md', 'plugins/cross-review/README.md'];
const chinese = path => path.replace(/\.md$/, '.zh-CN.md');
const all = english.flatMap(path => [path, chinese(path)]);
const source = path => readFile(resolve(repository, path), 'utf8');
const blocks = text => [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)].map(match => ({ language: match[1].trim(), body: match[2] }));
const prose = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').replace(/`[^`\n]*`/g, '');

// Checks the authored inline-Markdown link/ATX-heading subset, not remote URLs or
// arbitrary Markdown/HTML. Factual capability/localization audits remain human work.
function anchors(text) {
  const used = new Map();
  const result = new Set();
  for (const line of text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').split('\n')) {
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1];
    if (!heading) continue;
    const slug = heading.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const occurrence = used.get(slug) ?? 0;
    used.set(slug, occurrence + 1);
    result.add(occurrence ? `${slug}-${occurrence}` : slug);
  }
  return result;
}

test('reader documentation has complete English/Chinese pairs with reciprocal language navigation', async () => {
  for (const path of english) {
    const en = await source(path); const zh = await source(chinese(path));
    for (const [locale, text] of [['English', en], ['Chinese', zh]]) {
      assert.ok(text.startsWith('# '), `${path} ${locale}: missing title`);
      assert.ok(text.includes(`[English](${basename(path)})`), `${path} ${locale}: missing English navigation`);
      assert.ok(text.includes(`[简体中文](${basename(chinese(path))})`), `${path} ${locale}: missing Chinese navigation`);
    }
    assert.match(zh, /[\p{Script=Han}]/u, `${path}: untranslated Chinese page`);
  }
});

test('authored documentation relative links and heading anchors resolve within the repository', async () => {
  let checked = 0;
  for (const path of all) {
    for (const match of prose(await source(path)).matchAll(/\[[^\]\n]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
      const [targetPart, fragment] = href.split('#', 2);
      const target = targetPart ? resolve(repository, dirname(path), decodeURIComponent(targetPart)) : resolve(repository, path);
      assert.ok(target.startsWith(`${repository.replace(/\/$/, '')}${sep}`), `${path}: outside-repository link ${href}`);
      assert.equal((await stat(target)).isFile(), true, `${path}: missing file ${href}`);
      if (fragment) {
        assert.ok(anchors(await readFile(target, 'utf8')).has(decodeURIComponent(fragment)), `${path}: missing anchor ${href}`);
      }
      checked++;
    }
  }
  assert.ok(checked > all.length * 2, 'Expected both language navigation and content links');
});

test('bilingual executable examples agree and every documented pnpm script exists', async () => {
  const pkg = JSON.parse(await source('package.json'));
  for (const path of english) {
    const examples = text => blocks(text).filter(block => ['sh', 'json', 'yaml'].includes(block.language)).map(block => {
      if (block.language === 'json') return { language: block.language, value: JSON.parse(block.body) };
      if (block.language === 'yaml') return { language: block.language, value: parse(block.body) };
      return { language: block.language, value: block.body.trim() };
    });
    assert.deepEqual(examples(await source(chinese(path))), examples(await source(path)), `${path}: translated executable example drift`);
  }
  for (const path of all) {
    for (const block of blocks(await source(path)).filter(block => block.language === 'sh')) {
      for (const line of block.body.split('\n')) {
        const command = /^pnpm\s+(?:run\s+)?([^\s]+)/.exec(line)?.[1];
        if (!command || command === 'install') continue;
        assert.equal(typeof pkg.scripts[command], 'string', `${path}: unknown pnpm script ${command}`);
      }
    }
  }
});

test('package allowlist covers bilingual reader documentation and both indices', async () => {
  const pkg = JSON.parse(await source('package.json'));
  for (const path of all) {
    assert.ok(pkg.files.some(included => path === included || path.startsWith(`${included}/`)), `Not covered by package files: ${path}`);
  }
});
