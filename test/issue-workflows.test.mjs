import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import * as submit from '../plugins/issue-submit/resources/prepare.mjs';
import * as review from '../plugins/issue-review/resources/comment.mjs';
import { inspectPlugins } from '../scripts/lib/plugins.mjs';
import { divide } from './fixtures/issue-workflows/source.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const fixtureBase = new URL('./fixtures/issue-workflows/', import.meta.url);
const fixtureText = path => readFile(new URL(path, fixtureBase), 'utf8');
const [bug, feature, config, issueSource] = await Promise.all(['bug.yml', 'feature.md', 'config.yml', 'issue.json'].map(fixtureText));
const issue = JSON.parse(issueSource);
const formPath = '.github/ISSUE_TEMPLATE/bug.yml';
const markdownPath = '.github/ISSUE_TEMPLATE/feature.md';
const directory = '.github/ISSUE_TEMPLATE';
const legacyPath = '.github/ISSUE_TEMPLATE.md';
const configPath = `${directory}/config.yml`;
const absent = () => ({ status: 404 });
const file = content => ({ status: 200, kind: 'file', content });
function discovery() {
  return { repo: 'fixture/project', authenticated: true, repository: { full_name: 'fixture/project', has_issues: true, default_branch: 'main' }, files: {
    [directory]: { status: 200, kind: 'directory', entries: [formPath, markdownPath, configPath].map(path => ({ path, type: 'file' })) },
    [legacyPath]: file('## Legacy reproduction\n'), [configPath]: file(config), [formPath]: file(bug), [markdownPath]: file(feature),
  } };
}
const answers = () => ({ reproduction: "printf '%s' '``` untrusted $(touch SHOULD_NOT_EXIST)'", consent: ['I searched existing issues'], components: ['CLI', 'API'] });
function formDraft() { return submit.render({ catalog: submit.discover(discovery()), selection: formPath, title: "[Bug]: user's zero division", answers: answers() }); }
const yes = shown => ({ answers: [{ id: shown.question.id, selected: [shown.question.options[0].label] }] });
const reviewDraft = () => review.render({ repo: 'fixture/project', number: 7, reality: 'Real: divide(1, 0) returns Infinity, contrary to the contract.',
  reasonableness: 'Partly reasonable: reject a zero divisor, but replacing the entire API is unnecessary.', boundary: 'A minimal guard and a regression test; no API replacement or changes in this review.',
  evidence: ['source.mjs:2 at the isolated fixture revision', 'contract.md:3', 'Issue #7 and both comment pages'], limitations: 'Isolated fixture only; no production reproduction or paid model judgment.' });

// Pure data regressions exercise discovery/rendering/validation and exact argv, not keyword tests.
test('implemented Skill assets are independent, retain upstream source/license and have no native patch', async () => {
  const plugins = await inspectPlugins(repository);
  for (const id of ['issue-review', 'issue-submit']) {
    const descriptor = plugins.find(plugin => plugin.id === id); assert.ok(descriptor);
    assert.equal(descriptor.kind, 'skill'); assert.equal(descriptor.status, 'implemented');
    assert.equal(descriptor.skill, `plugins/${id}/SKILL.md`); assert.equal(descriptor.entry, undefined); assert.equal(descriptor.patch, undefined);
    assert.equal(await readFile(new URL(`../plugins/${id}/resources/LICENSE.upstream`, import.meta.url), 'utf8'), await readFile(new URL('../LICENSE', import.meta.url), 'utf8'));
    const original = await readFile(new URL(`../plugins/${id}/resources/upstream.md`, import.meta.url), 'utf8');
    assert.ok(original.startsWith(`---\nname: ${id}\n`));
    assert.ok((await readFile(new URL(`../plugins/${id}/SKILL.md`, import.meta.url), 'utf8')).includes('20194ff7a7b26fd51965e50bdb5091cb37a4c0f5'));
  }
});
test('forms, Markdown, legacy, config/contact links and blank permissions are discovered without guessing absence', () => {
  const present = submit.discover(discovery());
  assert.deepEqual(present.choices.map(value => value.kind), ['form', 'markdown']);
  assert.deepEqual(present.contacts, [{ name: 'Questions', about: 'Ask a usage question, not a bug report', url: 'https://example.invalid/discussions' }]);
  assert.equal(present.legacyPresent, true); assert.equal(present.blankEnabled, false);
  const missing = discovery(); missing.files[directory] = absent(); missing.files[configPath] = absent(); missing.files[legacyPath] = absent();
  assert.deepEqual(submit.discover(missing).choices.map(value => value.id), ['blank']);
  assert.throws(() => submit.render({ catalog: present, selection: 'blank', title: 'Test', body: 'Body' }), /Choose a discovered/);
  missing.files[legacyPath] = file('## Legacy\n');
  const old = submit.discover(missing); assert.deepEqual(old.choices.map(value => value.kind), ['legacy', 'blank']);
  assert.equal(submit.render({ catalog: old, selection: legacyPath, title: 'Legacy', body: '## Legacy\nAnswered' }).body, '## Legacy\nAnswered');
  missing.files[configPath] = file(config); missing.files[legacyPath] = absent();
  assert.equal(submit.discover(missing).choices.length, 0);
  assert.equal(submit.discover(missing).contacts.length, 1);
  for (const status of [0, 401, 403, 429, 500]) {
    const failed = discovery(); failed.files[configPath] = { status }; assert.throws(() => submit.discover(failed), /Read failed/);
  }
  const unread = discovery(); delete unread.files[legacyPath]; assert.throws(() => submit.discover(unread), /Missing read outcome/);
  for (const overrides of [{ authenticated: false }, { repository: { full_name: 'other/project', has_issues: true } }, { repository: { full_name: 'fixture/project', has_issues: false } }]) assert.throws(() => submit.discover({ ...discovery(), ...overrides }));
  for (const repo of ['--repo', 'https://github.com/a/b', 'a/b/c', '../repo', '', ['a/b', 'c/d']]) assert.throws(() => submit.target(repo));
});
test('form required values, defaults, dropdown multiplicity, consent and literal bodies are validated and rendered', () => {
  const catalog = submit.discover(discovery()); const draft = formDraft();
  assert.deepEqual(draft.labels, ['bug', 'needs,triage']); assert.deepEqual(draft.assignees, ['maintainer']);
  assert.equal(draft.body, "### Version\n\n1.0\n\n### Reproduction\n\n````shell\nprintf '%s' '``` untrusted $(touch SHOULD_NOT_EXIST)'\n````\n\n### Platform\n\nmacOS\n\n### Components\n\nCLI, API\n\n### Checks\n\n- [X] I searched existing issues\n- [ ] I can contribute a fix\n\n### Extra context\n\n_No response_");
  assert.ok(!draft.body.includes('rm -rf'));
  for (const value of [{}, { ...answers(), reproduction: ' ' }, { ...answers(), version: '' }, { ...answers(), consent: [] }, { ...answers(), platform: ['Linux', 'macOS'] }, { ...answers(), components: ['not an option'] }, { ...answers(), invented: 'yes' }]) {
    assert.throws(() => submit.render({ catalog, selection: formPath, title: 'Title', answers: value }));
  }
  const changed = submit.render({ catalog, selection: formPath, title: 'Title', answers: answers(), labels: [], assignees: [] });
  assert.deepEqual(changed.labels, []); assert.deepEqual(changed.assignees, []);
  const markdown = submit.render({ catalog, selection: markdownPath, body: '## Goal\nKeep it small\n\n## Boundary\nNo runtime' });
  assert.equal(markdown.title, '[Feature]: '); assert.deepEqual(markdown.labels, ['enhancement']); assert.deepEqual(markdown.assignees, ['maintainer']);
  assert.ok(catalog.choices[1].body.includes('## Goal'));
  const malformed = discovery(); malformed.files[formPath] = file('name: Broken\nbody: ['); assert.throws(() => submit.discover(malformed), /Malformed/);
  const invalidDefault = discovery(); invalidDefault.files[formPath] = file(bug.replace('default: 1', 'default: 10')); assert.throws(() => submit.discover(invalidDefault), /default/);
  const unsupported = discovery(); unsupported.files[formPath] = file(bug.replace('type: input', 'type: executable')); assert.throws(() => submit.discover(unsupported), /Unsupported/);
  const symlink = discovery(); symlink.files[directory].entries[0].type = 'symlink'; assert.throws(() => submit.discover(symlink), /regular file/);
});
test('final argv retains exact rendered content/metadata and rejects cancel, missing, stale or pending confirmation', () => {
  for (const [module, draft, fn] of [[submit, formDraft(), submit.submissionArguments], [review, reviewDraft(), review.commentArguments]]) {
    const shown = module.preview(draft); const confirmed = yes(shown);
    assert.ok(shown.question.question.includes(draft.body));
    const argv = fn(draft, confirmed); assert.equal(argv[argv.indexOf('--body') + 1], draft.body); assert.equal(argv[argv.indexOf('--repo') + 1], draft.repo);
    assert.ok(!argv.includes('--template')); assert.ok(!argv.includes('--edit-last')); assert.ok(!argv.includes('--web'));
    for (const answer of [undefined, { pending: true }, { answers: [] }, { answers: [{ id: shown.question.id, selected: [] }] }, { answers: [{ id: shown.question.id, selected: ['Cancel'] }] }, { answers: [{ id: shown.question.id, selected: [shown.question.options[0].label], custom: 'changed' }] }]) assert.throws(() => fn(draft, answer));
    assert.throws(() => fn({ ...draft, body: draft.body + '\nChanged' }, confirmed), /changed/);
    assert.throws(() => fn({ ...draft, repo: 'another/target' }, confirmed), /changed/);
  }
  assert.deepEqual(submit.submissionArguments(formDraft(), yes(submit.preview(formDraft()))).slice(-6), ['--label', 'bug', '--label', '"needs,triage"', '--assignee', 'maintainer']);
  assert.throws(() => review.render({ ...reviewDraft(), evidence: [] }), /Evidence/);
  for (const number of [0, -1, '7', [7, 8], 1.5]) assert.throws(() => review.preview({ ...reviewDraft(), number }));
});
test('uncertain write readback never authorizes retry, including no match, duplicate, incomplete or mismatched payload', () => {
  const since = '2026-01-01T00:00:00Z';
  for (const [module, draft, url] of [[submit, formDraft(), 'https://github.com/fixture/project/issues/42'], [review, reviewDraft(), 'https://github.com/fixture/project/issues/7#issuecomment-42']]) {
    const result = { user: { login: 'fixture-user' }, created_at: since, html_url: url, title: draft.title, body: draft.body, labels: draft.labels, assignees: draft.assignees };
    const readback = { records: [result], complete: true, author: 'fixture-user', since };
    assert.deepEqual(module.reconcile(draft, readback), { status: 'verified', url, retry: false });
    assert.deepEqual(module.reconcile(draft, { ...readback, records: [] }), { status: 'unresolved', retry: false });
    assert.deepEqual(module.reconcile(draft, { ...readback, complete: false }), { status: 'unresolved', retry: false });
    assert.deepEqual(module.reconcile(draft, { ...readback, records: [result, result] }), { status: 'ambiguous', retry: false });
    for (const update of [{ body: 'different' }, { user: { login: 'other' } }, { html_url: 'https://github.com/other/project/issues/42' }, { created_at: '2025-12-31T00:00:00Z' }]) assert.equal(module.reconcile(draft, { ...readback, records: [{ ...result, ...update }] }).status, 'unresolved');
  }
});
test('JSON-stdin resource entry points prepare argv without executing writes or creating draft files', () => {
  for (const [name, module, draft] of [['issue-submit', submit, formDraft()], ['issue-review', review, reviewDraft()]]) {
    const resource = new URL(`../plugins/${name}/resources/${name === 'issue-submit' ? 'prepare' : 'comment'}.mjs`, import.meta.url);
    const output = execFileSync(process.execPath, [fileURLToPath(resource)], { input: JSON.stringify({ action: 'arguments', draft, answer: yes(module.preview(draft)) }), encoding: 'utf8', cwd: repository });
    assert.deepEqual(JSON.parse(output), name === 'issue-submit' ? submit.submissionArguments(draft, yes(module.preview(draft))) : review.commentArguments(draft, yes(module.preview(draft))));
  }
});

// Applicable scripted DSH rehearsal: actual repository Skill text, public production
// AgentLoop and native root questions. Only in-memory gh/argv and fixture-read tools
// exist; no shell executor, real provider, network, profile or generic product runtime.
class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.calls = []; }
  providerInfo(id) { return { id, name: 'Offline issue Skill rehearsal' }; }
  async resolveModel(provider, id) { return { provider, id, name: id }; }
  async *stream(options) {
    this.calls.push(options); const calls = await this.script(options, this.calls.length);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call', id: ToolCallId(`issue-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}
const call = (name, args) => [{ name, args }];
async function nativeFixture(t, skillName, script, handler, questionAnswer) {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await mountAgentLoopTestDependencies(ctx); await ctx.plugin(UserQuestionService);
  const state = { skillLoaded: false, events: [], writes: [], questions: [], helper: undefined, answer: undefined, errors: [] };
  const adapter = new ScriptedAdapter((options, n) => script(state, options, n));
  ctx.llm.registerAdapter(['offline'], adapter);
  const harness = await mountAgentLoopTestHarness(ctx);
  const parent = await harness.create(SessionId('issue-skill-root'), { provider: 'offline', model: 'scripted' }, { cwd: fileURLToPath(fixtureBase) });
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  ctx.tools.register(defineTool({ name: 'skill', description: 'Load exactly the repository Skill under rehearsal.', parameters: { name: { type: 'string', required: true } }, output, async execute(args) {
    assert.equal(args.name, skillName); state.skillLoaded = true; state.events.push('skill'); return readFile(new URL(`../plugins/${skillName}/SKILL.md`, import.meta.url), 'utf8');
  } }));
  ctx.tools.register(defineTool({ name: 'read', description: 'Read evidence-only isolated fixture paths.', parameters: { path: { type: 'string', required: true } }, output, async execute({ path }) {
    assert.ok(['source.mjs', 'contract.md', 'issue.json'].includes(path)); state.events.push(`read:${path}`); return fixtureText(path);
  } }));
  ctx.tools.register(defineTool({ name: 'bash', description: 'Rehearsal-only argv transport: in-memory gh responses and pure resource calls; no shell.', parameters: { argv: { type: 'array', items: { type: 'string' }, required: true }, input: { type: 'string' } }, output, async execute(args) {
    assert.equal(state.skillLoaded, true); state.events.push(args.argv.join(' '));
    try { return JSON.stringify(await handler(state, args)); } catch (error) { state.errors.push(error.message); return JSON.stringify({ error: error.message }); }
  } }));
  // Thin test-only adapter to the real native question service, not a fake answer tool.
  ctx.tools.register(defineTool({ name: 'ask_user_question', description: 'Ask through native live-root userQuestions.', parameters: { questions: { type: 'json', required: true } }, output, async execute(args, exec) {
    try { state.answer = await ctx.userQuestions.ask({ questions: args.questions, agent: exec.agent, signal: exec.signal }); return JSON.stringify(state.answer); }
    catch (error) { state.errors.push(error.code); return JSON.stringify({ error: error.code }); }
  } }));
  if (questionAnswer) parent.ctx.on('user-questions/request', async request => {
    assert.equal(request.agent, parent); state.questions.push(...request.questions);
    return questionAnswer(state, request);
  });
  parent.followup(createUserMessage({ content: [{ type: 'text', text: `Rehearse ${skillName} against isolated fixture/project. Load the Skill first. The bash fixture accepts argv arrays, never shell strings. Do not access a real forge or modify code.` }], source: { kind: 'user' } }));
  await parent.whenIdle();
  assert.equal(state.skillLoaded, true);
  assert.ok(adapter.calls.length > 1);
  assert.ok(adapter.calls[1].messages.some(message => message.role === 'tool' && message.content.some(block => block.type === 'text' && block.text.includes(`# ${skillName === 'issue-submit' ? 'Issue Submit' : 'Issue Review'}`))));
  return { ctx, parent, state, adapter };
}
function resource(state, argv, input) {
  const args = JSON.parse(input); const module = argv[1] === 'prepare.mjs' ? submit : review;
  state.helper = args.action === 'discover' ? submit.discover(args) : args.action === 'render' ? module.render(args) : args.action === 'preview' ? module.preview(args.draft)
    : args.action === 'arguments' ? (module === submit ? submit.submissionArguments(args.draft, args.answer) : review.commentArguments(args.draft, args.answer))
    : module.reconcile(args.draft, args.readback);
  return state.helper;
}
const utility = (filename, input) => call('bash', { argv: ['node', filename], input: JSON.stringify(input) });

test('scripted root submit rehearsal: discovery, required question, complete preview and exact one write/readback', { timeout: 15_000 }, async t => {
  for (const mode of ['confirm', 'cancel', 'unavailable', 'auth-failure', 'uncertain']) await t.test(mode, async t => {
    let draft; let shown; const input = discovery(); let requiredCollected = false;
    const paths = [directory, legacyPath, configPath, formPath, markdownPath];
    const f = await nativeFixture(t, 'issue-submit', (state, _options, n) => {
      if (n === 1) return call('skill', { name: 'issue-submit' });
      if (n === 2) return call('bash', { argv: ['gh', 'auth', 'status', '--hostname', 'github.com'] });
      if (mode === 'auth-failure') return [];
      if (n === 3) return call('bash', { argv: ['gh', 'api', 'repos/fixture/project'] });
      if (n === 4) return call('bash', { argv: ['gh', 'api', 'repos/fixture/project/commits/main'] });
      if (n >= 5 && n <= 9) return call('bash', { argv: ['gh', 'api', `repos/fixture/project/contents/${paths[n - 5]}?ref=fixture-sha`] });
      if (n === 10) return utility('prepare.mjs', { action: 'discover', ...input });
      if (n === 11) return call('ask_user_question', { questions: [
        { id: 'template', question: 'Select a discovered template.', options: [{ label: formPath }, { label: markdownPath }] },
        { id: 'reproduction', question: 'Provide the required reproduction (not the placeholder).' },
        { id: 'consent', question: 'Confirm the required checkbox.', options: [{ label: 'I searched existing issues' }] },
        { id: 'components', question: 'Select components.', options: [{ label: 'CLI' }, { label: 'API' }], multiSelect: true },
        { id: 'defaults', question: 'Retain Version=1.0, Platform=macOS, labels and assignees?', options: [{ label: 'Retain defaults' }] },
      ] });
      if (mode === 'unavailable') return [];
      if (n === 12) {
        const values = Object.fromEntries(state.answer.answers.map(answer => [answer.id, answer]));
        assert.deepEqual(values.defaults.selected, ['Retain defaults']); requiredCollected = true;
        return utility('prepare.mjs', { action: 'render', catalog: state.helper, selection: values.template.selected[0], title: 'Zero division', answers: { reproduction: values.reproduction.custom, consent: values.consent.selected, components: values.components.selected } });
      }
      if (n === 13) { draft = state.helper; return utility('prepare.mjs', { action: 'preview', draft }); }
      if (n === 14) { shown = state.helper; return call('ask_user_question', { questions: [shown.question] }); }
      if (n === 15) return utility('prepare.mjs', { action: 'arguments', draft, answer: state.answer });
      if (mode === 'cancel') return [];
      if (n === 16) return call('bash', { argv: ['gh', ...state.helper] });
      if (n === 17) return call('bash', { argv: ['gh', 'api', '--paginate', 'recent-issues-readback'] });
      if (n === 18) return utility('prepare.mjs', { action: 'reconcile', draft, readback: state.helper });
      return [];
    }, (state, { argv, input: stdin }) => {
      if (argv[0] === 'node') return resource(state, argv, stdin);
      if (argv[1] === 'auth') return mode === 'auth-failure' ? { exitCode: 1, error: 'not authenticated' } : { exitCode: 0 };
      if (argv[2] === 'repos/fixture/project') return input.repository;
      if (argv[2] === 'repos/fixture/project/commits/main') return { sha: 'fixture-sha' };
      if (argv[2]?.startsWith('repos/fixture/project/contents/')) {
        const path = argv[2].slice('repos/fixture/project/contents/'.length).split('?')[0];
        assert.ok(paths.includes(path)); assert.ok(argv[2].endsWith('?ref=fixture-sha')); return input.files[path];
      }
      if (argv[1] === 'issue' && argv[2] === 'create') {
        assert.ok(requiredCollected); assert.equal(state.questions.length, 6); assert.equal(state.writes.length, 0);
        assert.deepEqual(argv, ['gh', ...submit.submissionArguments(draft, yes(shown))]); state.writes.push(argv);
        return mode === 'uncertain' ? { exitCode: 1, error: 'EOF after server accepted' } : { exitCode: 0, url: 'https://github.com/fixture/project/issues/42' };
      }
      if (argv.includes('recent-issues-readback')) {
        state.helper = { complete: true, author: 'fixture-user', since: '2026-01-01T00:00:00Z', records: [{ user: { login: 'fixture-user' }, created_at: '2026-01-01T00:00:01Z', html_url: 'https://github.com/fixture/project/issues/42', title: draft.title, body: draft.body, labels: draft.labels, assignees: draft.assignees }] };
        return state.helper;
      }
      assert.fail(`Unexpected fixture command ${argv}`);
    }, mode === 'unavailable' ? undefined : (_state, { questions }) => questions[0].id === 'template' ? { answers: [
      { id: 'template', selected: [formPath] }, { id: 'reproduction', selected: [], custom: answers().reproduction },
      { id: 'consent', selected: ['I searched existing issues'] }, { id: 'components', selected: ['CLI', 'API'] }, { id: 'defaults', selected: ['Retain defaults'] },
    ] } : mode === 'cancel' ? { answers: [{ id: questions[0].id, selected: ['Cancel'] }] } : yes({ question: questions[0] }));
    assert.equal(f.state.writes.length, ['confirm', 'uncertain'].includes(mode) ? 1 : 0);
    if (['confirm', 'uncertain'].includes(mode)) { assert.equal(f.state.helper.status, 'verified'); assert.equal(f.state.helper.retry, false); }
    if (mode === 'unavailable') assert.ok(f.state.errors.includes('NO_PROVIDER'));
    if (mode === 'cancel') assert.ok(f.state.errors.some(value => value.includes('Cancelled')));
  });
});
test('scripted root review rehearsal reads full issue/comments and source/contracts, previews three conclusions, does not edit code', { timeout: 15_000 }, async t => {
  const evidenceBefore = await fixtureText('source.mjs'); let draft; let shown;
  const f = await nativeFixture(t, 'issue-review', (state, _options, n) => {
    if (n === 1) return call('skill', { name: 'issue-review' });
    if (n === 2) return call('bash', { argv: ['gh', 'auth', 'status', '--hostname', 'github.com'] });
    if (n === 3) return call('bash', { argv: ['gh', 'api', 'repos/fixture/project/issues/7'] });
    if (n === 4) return call('bash', { argv: ['gh', 'api', '--paginate', 'repos/fixture/project/issues/7/comments'] });
    if (n === 5) return call('read', { path: 'source.mjs' });
    if (n === 6) return call('read', { path: 'contract.md' });
    if (n === 7) { assert.equal(state.commentPages, 2); assert.equal(divide(1, 0), Infinity); return utility('comment.mjs', { action: 'render', repo: 'fixture/project', number: 7,
      reality: 'Real: divide(1, 0) returns Infinity, contrary to the contract.', reasonableness: 'Partly reasonable: reject zero, but replacing the entire API is unnecessary.', boundary: 'Minimal guard and regression; no edits during review.', evidence: ['source.mjs:2', 'contract.md:3', 'Both issue comment pages'], limitations: 'Isolated fixture only; no production or paid model judgment.' }); }
    if (n === 8) { draft = state.helper; return utility('comment.mjs', { action: 'preview', draft }); }
    if (n === 9) { shown = state.helper; return call('ask_user_question', { questions: [shown.question] }); }
    if (n === 10) return utility('comment.mjs', { action: 'arguments', draft, answer: state.answer });
    if (n === 11) return call('bash', { argv: ['gh', ...state.helper] });
    if (n === 12) return call('bash', { argv: ['gh', 'api', '--paginate', 'repos/fixture/project/issues/7/comments'] });
    if (n === 13) return utility('comment.mjs', { action: 'reconcile', draft, readback: state.helper });
    return [];
  }, (state, { argv, input }) => {
    if (argv[0] === 'node') return resource(state, argv, input);
    if (argv[1] === 'auth') return { exitCode: 0 };
    if (argv[2] === 'repos/fixture/project/issues/7') return issue;
    if (argv.includes('repos/fixture/project/issues/7/comments')) {
      if (!state.writes.length) { state.commentPages = issue.comments.length; return issue.comments.flat(); }
      state.helper = { complete: true, author: 'fixture-user', since: '2026-01-01T00:00:00Z', records: [{ user: { login: 'fixture-user' }, created_at: '2026-01-01T00:00:01Z', html_url: 'https://github.com/fixture/project/issues/7#issuecomment-42', body: draft.body }] };
      return state.helper;
    }
    if (argv[1] === 'issue' && argv[2] === 'comment') { assert.deepEqual(argv, ['gh', ...review.commentArguments(draft, yes(shown))]); assert.equal(state.writes.length, 0); state.writes.push(argv); return { exitCode: 1, error: 'uncertain EOF' }; }
    assert.fail(`Unexpected command ${argv}`);
  }, (_state, { questions }) => yes({ question: questions[0] }));
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.helper.status, 'verified'); assert.equal(f.state.helper.retry, false);
  assert.ok(f.state.questions[0].question.includes(draft.body)); assert.ok(draft.body.includes('Reality')); assert.ok(draft.body.includes('Reasonableness')); assert.ok(draft.body.includes('Boundary'));
  assert.equal(await fixtureText('source.mjs'), evidenceBefore); assert.equal(createHash('sha256').update(evidenceBefore).digest('hex'), createHash('sha256').update(await fixtureText('source.mjs')).digest('hex'));
});
test('native question service rejects delegated and forged callers; child returns pending decision rather than posting', { timeout: 15_000 }, async t => {
  const f = await nativeFixture(t, 'issue-review', (_state, _options, n) => n === 1 ? call('skill', { name: 'issue-review' }) : [], () => assert.fail('No CLI expected'), undefined);
  await f.ctx.plugin(Subagents, { maxDepth: 1, maxActiveSubagents: 2 }); await f.ctx.plugin(Spawn, { providerName: 'spawn' });
  const question = review.preview(reviewDraft()).question;
  await assert.rejects(f.ctx.userQuestions.ask({ agent: { ...f.parent }, questions: [question] }), error => error.code === 'CALLER_NOT_LIVE');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.ctx.userQuestions.ask({ agent: f.parent, questions: [question], signal: cancelled.signal }), error => error.code === 'ASK_ABORTED');
  let delegatedError;
  f.ctx.on('agent/created', async ({ agent }) => {
    if (agent === f.parent) return;
    try { await f.ctx.userQuestions.ask({ agent, questions: [question] }); } catch (error) { delegatedError = error.code; }
  });
  f.adapter.script = () => call('structured_output', { pendingQuestion: question.question });
  const run = await f.ctx.subagents.start('spawn', { parent: f.parent, label: 'pending-confirmation', signal: new AbortController().signal, prompt: [{ type: 'text', text: 'Return the unresolved confirmation to your parent. Do not post.' }], agentOptions: { provider: 'offline', model: 'child' }, toolFilter: { allow: [] }, outputSchema: { type: 'object', properties: { pendingQuestion: { type: 'string' } }, required: ['pendingQuestion'], additionalProperties: false }, maxDepth: 1 });
  t.after(() => run.dispose()); const result = await run.result;
  assert.equal(delegatedError, 'DELEGATED_CALLER'); assert.equal(result.structured.pendingQuestion, question.question); assert.equal(f.state.writes.length, 0);
  await run.dispose();
});
