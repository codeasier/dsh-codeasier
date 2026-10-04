// Test-only scripted rehearsal, not a shipped workflow interpreter or prompt-safety engine.
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Questions from '@deepseek-ai/dsh-user-questions';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';

const require = createRequire(import.meta.url);
const dshRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
// Resolve the package's public entry via its public owning dependency, no private seams.
const AskUser = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-tool-ask-user')).href);

class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.calls = []; }
  providerInfo(id) { return { id, name: 'Workflow rehearsal (offline)' }; }
  async resolveModel(provider, id) { return { provider, id, name: id }; }
  async *stream(options) {
    this.calls.push(options);
    const calls = await this.script(options, this.calls.length);
    for (const [index, call] of calls.entries()) {
      const block = { type: 'tool-call', id: ToolCallId(`workflow-${this.calls.length}-${index}`), name: call.name, arguments: JSON.stringify(call.args) };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index, block };
    }
    yield { type: 'finish', reason: calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } };
  }
}

// The fixture boundary protects only disposable test files. It is NOT a Skill guarantee.
export async function safeFixturePath(root, path) {
  const target = resolve(root, path);
  assert.ok(target.startsWith(`${root}${sep}`), 'fixture path escapes root');
  let current = root;
  const parts = relative(root, target).split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert.equal(info.isSymbolicLink(), false, 'unsafe symlink');
    if (index < parts.length - 1) assert.equal(info.isDirectory(), true, 'non-directory ancestor');
    else assert.equal(info.isFile(), true, 'non-regular target');
  }
  return target;
}

export async function canonicalHandoff(root, args) {
  assert.equal(args.length, 1, 'exactly one handoff name');
  assert.match(args[0], /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid handoff name');
  return safeFixturePath(root, `.agent/handoff/${args[0]}/HANDOFF.md`);
}

export async function snapshot(root) {
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(root, path)] = await readFile(path, 'utf8');
      else files[relative(root, path)] = '<non-regular>';
    }
  }
  await visit(root);
  return files;
}

export const call = (name, args) => [{ name, args }];
export const read = file_path => call('read', { file_path });
export const write = (file_path, content) => call('write', { file_path, content });
export const report = value => call('fixture_report', { value });
export const ask = (id, question, labels = ['Yes (Recommended)', 'No']) => call('ask_user_question', { questions: [{ id, question, options: labels.map(label => ({ label, description: label.includes('Recommended') ? 'Recommended because it keeps the requested scope explicit.' : 'Decline or choose another scope.' })) }] });

export async function fixture(t, skill, script, { files = {}, answer, questionMode = 'legacy' } = {}) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'dsh-workflow-skill-')));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    assert.equal(resolve(root), root); assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('dsh-workflow-skill-')); assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  for (const [path, content] of Object.entries(files)) {
    const target = await safeFixturePath(root, path);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
  }
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Questions); await ctx.plugin(AskUser, { mode: questionMode, timeout: 1 });
  const reports = [], operations = [], results = [], questions = [];
  ctx.on('tools/result', (exec, result) => { results.push({ name: exec.name, result }); });
  const adapter = new ScriptedAdapter(script);
  ctx.llm.registerAdapter(['workflow-fixture'], adapter);
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  for (const name of ['read', 'write', 'edit']) {
    ctx.tools.register(defineTool({
      name, description: `Disposable fixture ${name}; never a product backend.`,
      parameters: { file_path: { type: 'string', required: true }, content: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, output,
      async execute(args) {
        const target = await safeFixturePath(root, args.file_path);
        operations.push({ name, path: relative(root, target) });
        if (name === 'read') return readFile(target, 'utf8');
        let content = args.content;
        if (name === 'edit') {
          const previous = await readFile(target, 'utf8');
          assert.equal(previous.split(args.old_string).length, 2, 'targeted edit must have one match');
          content = previous.replace(args.old_string, args.new_string);
        }
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
        return 'written';
      },
    }));
  }
  ctx.tools.register(defineTool({ name: 'fixture_report', description: 'Capture rehearsal response without writing a report file.', parameters: { value: { type: 'json', required: true } }, output,
    async execute(args) { reports.push(args.value); return JSON.stringify(args.value); },
  }));
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('workflow-root'), { provider: 'workflow-fixture', model: 'root' }, { cwd: root });
  if (answer) agent.ctx.on('user-questions/request', async request => {
    questions.push(request.questions);
    assert.equal(request.agent, agent); assert.equal(request.questions.length, 1);
    return answer(request.questions[0], questions.length);
  });
  const instruction = await readFile(new URL(`../../plugins/${skill}/SKILL.md`, import.meta.url), 'utf8');
  async function run(text = 'Rehearse this workflow only in the disposable fixture. fixture_report captures the response; it is not a shipped Skill tool.') {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `${instruction}\n\n${text}` }], source: { kind: 'user' } }));
    await agent.whenIdle();
    assert.ok(adapter.calls.some(options => options.messages.some(message => message.content?.some(block => block.type === 'text' && block.text.includes(instruction)))));
  }
  return { root, ctx, harness, agent, adapter, instruction, run, reports, operations, results, questions };
}
