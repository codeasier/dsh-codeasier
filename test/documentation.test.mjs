import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { inspectPlugins } from '../scripts/lib/plugins.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const coreEnglish = ['README.md', 'docs/README.md', 'docs/architecture.md', 'docs/plugin-development.md',
  'docs/contracts.md', 'docs/tui-admission-gap.md', 'plugins/cross-review/README.md'];
const english = [...new Set([...coreEnglish,
  ...(await readdir(resolve(repository, 'docs'), { recursive: true })).filter(path => path.endsWith('.md') && !path.endsWith('.zh-CN.md')).map(path => `docs/${path}`),
  ...(await inspectPlugins(repository)).map(plugin => `plugins/${plugin.id}/README.md`),
])];
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

// Focused authored-prose regressions, not profile boot or general model-compliance tests.
test('cross-review guides distinguish configuration-save and review-start diagnostics', async () => {
  const setup = await source('src/plugins/cross-review/configuration.ts');
  const startup = await source('src/plugins/cross-review/service.ts');
  const saveMessages = ['Configuration authorization denied by host policy', 'Native configuration authorization is unavailable'];
  const startMessages = ['Review cost authorization rejected', 'Native startup authorization is unavailable'];
  for (const message of saveMessages) assert.ok(setup.includes(message));
  assert.ok(startup.includes(startMessages[1]));
  assert.ok(startup.includes('Review cost authorization ${outcome}'));
  for (const path of ['plugins/cross-review/README.md', 'docs/contracts.md'].flatMap(path => [path, chinese(path)])) {
    const lines = (await source(path)).split('\n');
    for (const [tool, messages, otherMessages] of [
      ['cross_config_save', saveMessages, startMessages],
      ['cross_review_start', startMessages, saveMessages],
    ]) {
      const diagnostic = lines.find(line => line.startsWith(`- \`${tool}\`:`));
      assert.ok(diagnostic, `${path}: missing stage-specific ${tool} diagnostic`);
      for (const message of messages) assert.ok(diagnostic.includes(message), `${path}: missing ${tool} error ${message}`);
      for (const message of otherMessages) assert.ok(!diagnostic.includes(message), `${path}: ${tool} uses another stage's error`);
    }
  }
});

test('cross-review boot remediation acknowledges composed permission presets', async () => {
  for (const path of ['plugins/cross-review/README.md', 'plugins/cross-review/README.zh-CN.md']) {
    const text = await source(path);
    assert.ok(text.includes('permission-presets'), `${path}: missing preset-composition prerequisite`);
    assert.ok(text.includes('defaultPreset'), `${path}: missing matching session-default prerequisite`);
    assert.doesNotMatch(text, /boot with a user overlay that overrides only the `approval` row|用只覆盖 `approval` 行/);
  }
});

test('cross-review completion guidance limits partial Host masking to the affected fields', async () => {
  const skill = await source('plugins/cross-review/SKILL.md');
  assert.ok(skill.includes('report only those keys as masked'));
  assert.ok(skill.includes('unless all of its relevant keys are shadowed'));
  assert.ok((await source('docs/contracts.md')).includes('only those fields are masked'));
  assert.ok((await source('docs/contracts.zh-CN.md')).includes('仅这些字段被覆盖'));
});
