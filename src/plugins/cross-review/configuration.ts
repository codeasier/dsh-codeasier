import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolCallId } from '@deepseek-ai/dsh-llm';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { freezeRecursively, layerSchema, parseConfig, type ConfigLayer, type ReviewConfig } from './protocol.js';

export type ConfigurationScope = 'local' | 'global';
const filename = 'cross-review.json';
const maxBytes = 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Fixed paths, not caller-provided destinations. Worktrees never inherit a parent project's file. */
export async function configurationPaths(cwd: string, home = homedir()) {
  for (const root of [cwd, home]) {
    if (!isAbsolute(root) || resolve(root) !== root || await realpath(root) !== root) throw new Error('Configuration root must be a canonical absolute directory');
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe configuration root');
  }
  return { global: join(home, '.dsh', filename), local: join(cwd, '.dsh', filename) };
}

async function inspect(path: string, writable = false): Promise<void> {
  for (let current = path; ; current = dirname(current)) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (current === path ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) throw new Error(`Unsafe configuration path: ${current}`);
      if (writable && (current === path || current === dirname(path) || current === dirname(dirname(path))) && process.getuid && info.uid !== process.getuid()) throw new Error('Configuration ownership mismatch');
    } catch (error) { if (!missing(error)) throw error; }
    if (dirname(current) === current) break;
  }
}

async function readConfiguration(path: string): Promise<{ bytes: string; value: unknown } | undefined> {
  await inspect(path);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes) throw new Error('Invalid or oversized configuration file');
    const buffer = await handle.readFile();
    if (buffer.length > maxBytes) throw new Error('Oversized configuration file');
    const bytes = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { bytes, value: layerSchema.parse(JSON.parse(bytes)) };
  } finally { await handle.close(); }
}

export async function loadFileLayers(cwd: string, home = homedir()): Promise<ConfigLayer[]> {
  const paths = await configurationPaths(cwd, home);
  const layers: ConfigLayer[] = [];
  for (const scope of ['global', 'local'] as const) {
    const file = await readConfiguration(paths[scope]);
    if (file) layers.push({ source: `${scope}:${paths[scope]}`, value: file.value });
  }
  return layers;
}

/** Catalog and resolution checks only: never dispatches inference or creates a reviewer. */
export async function validateRoutes(ctx: Context, config: ReviewConfig): Promise<void> {
  const routes = [...config.reviewers, ...(config.judge.kind === 'model' ? [config.judge] : [])];
  for (const route of routes) {
    if (!ctx.llm.listProviders().some(provider => provider.id === route.provider)) throw new Error(`Unavailable provider: ${route.provider}`);
    const available = await ctx.llm.listModels(route.provider);
    if (!available.some(model => model.provider === route.provider && model.id === route.model)) throw new Error(`Unavailable exact model: ${route.provider}/${route.model}`);
    const actual = await ctx.llm.resolveModelInfo(route.provider, route.model);
    if (actual.provider !== route.provider || actual.id !== route.model) throw new Error('Model resolution changed the requested route');
  }
}

interface SetupPlan {
  setupId: string; scope: ConfigurationScope; path: string; exists: boolean; configuration: ReviewConfig;
  effectiveConfig: ReviewConfig; sources: Readonly<Record<string, string>>; expiresAt: number; reviewPrerequisite: string;
}
interface PendingSetup { owner: Agent; cwd: string; plan: SetupPlan; previousDigest?: string; layersDigest: string }

/** Separate setup authority; confirmation here cannot authorize a review. */
export class ConfigurationService {
  private readonly pending = new Map<string, PendingSetup>();
  private closing = false;
  private readonly shutdown = new AbortController();
  private readonly writes = new Set<Promise<unknown>>();
  constructor(private readonly ctx: Context, private readonly hostLayers: readonly ConfigLayer[] = [], private readonly home = homedir()) {}
  private assertAgent(agent: Agent): string {
    if (this.closing || this.ctx.agents.get(agent.session.id) !== agent) throw new Error('Configuration requires the exact live owning Agent');
    const cwd = agent.session.header.cwd;
    if (!cwd) throw new Error('Owning Agent has no workspace');
    return cwd;
  }
  private async effective(cwd: string, replacement?: { scope: ConfigurationScope; configuration: ReviewConfig }) {
    const paths = await configurationPaths(cwd, this.home);
    const files = await loadFileLayers(cwd, this.home);
    const layers = replacement
      ? (['global', 'local'] as const).flatMap(scope => paths[scope] === paths[replacement.scope]
        ? [{ source: `${scope}:${paths[scope]}`, value: replacement.configuration }]
        : files.filter(layer => layer.source === `${scope}:${paths[scope]}`))
      : files;
    return { ...parseConfig([...layers, ...this.hostLayers]), layersDigest: digest(JSON.stringify(files)) };
  }
  async catalog(agent: Agent) {
    this.assertAgent(agent);
    const providers = await Promise.all(this.ctx.llm.listProviders().map(async provider => ({
      id: provider.id, name: provider.name, models: (await this.ctx.llm.listModels(provider.id)).filter(model => model.provider === provider.id).map(model => ({ provider: model.provider, id: model.id, name: model.name })),
    })));
    this.assertAgent(agent);
    return { providers, validation: 'Runtime catalog only; no inference or credential-success claim.' };
  }
  async preview(agent: Agent, scope: ConfigurationScope, configuration: unknown): Promise<SetupPlan> {
    const cwd = this.assertAgent(agent);
    if (scope !== 'local' && scope !== 'global') throw new Error('Invalid configuration scope');
    const paths = await configurationPaths(cwd, this.home);
    const path = paths[scope];
    await inspect(path, true);
    const previous = await readConfiguration(path);
    const candidate = parseConfig([{ source: 'setup', value: configuration }]).config;
    await validateRoutes(this.ctx, candidate);
    const effective = await this.effective(cwd, { scope, configuration: candidate });
    await validateRoutes(this.ctx, effective.config);
    this.assertAgent(agent);
    const plan = freezeRecursively({ setupId: randomUUID(), scope, path, exists: !!previous, configuration: candidate, effectiveConfig: effective.config, sources: effective.sources, expiresAt: Date.now() + 15 * 60_000, reviewPrerequisite: 'Local review rejects changed or unignored .dsh runtime files. Git-ignore the local configuration before local review using separately chosen project policy; setup does not change Git ignore rules.' });
    for (const [id, old] of this.pending) if (old.plan.expiresAt < Date.now()) this.pending.delete(id);
    this.pending.set(plan.setupId, { owner: agent, cwd, plan, previousDigest: previous && digest(previous.bytes), layersDigest: effective.layersDigest });
    return plan;
  }
  async validate(agent: Agent, scope: ConfigurationScope) {
    const cwd = this.assertAgent(agent);
    if (scope !== 'local' && scope !== 'global') throw new Error('Invalid configuration scope');
    const path = (await configurationPaths(cwd, this.home))[scope];
    const file = await readConfiguration(path);
    if (!file) throw new Error('Configuration file does not exist');
    const configuration = file.value;
    const effective = await this.effective(cwd);
    await validateRoutes(this.ctx, effective.config);
    this.assertAgent(agent);
    return { path, configuration, effectiveConfig: effective.config, sources: effective.sources, validation: 'Re-read file schema and layered effective configuration; exact effective provider/model catalog and resolution; no paid inference or evidence capture.', reviewPrerequisite: 'Local configuration must be Git-ignored before local review; changed or unignored .dsh files remain rejected. Setup does not change Git ignore rules.' };
  }
  async save(agent: Agent, setupId: string, signal: AbortSignal, callId?: ToolCallId) {
    const task = this.saveConfirmed(agent, setupId, AbortSignal.any([signal, this.shutdown.signal]), callId);
    this.writes.add(task);
    void task.finally(() => this.writes.delete(task)).catch(() => {});
    return task;
  }
  private async saveConfirmed(agent: Agent, setupId: string, signal: AbortSignal, callId?: ToolCallId) {
    const cwd = this.assertAgent(agent);
    const pending = this.pending.get(setupId);
    if (!pending || pending.owner !== agent || pending.cwd !== cwd || pending.plan.expiresAt < Date.now()) throw new Error('Unknown, expired, or unowned setup preview');
    signal.throwIfAborted();
    this.pending.delete(setupId); // One confirmation attempt; refusal requires a fresh preview.
    const { plan } = pending;
    const approval = this.ctx.get('approval', false);
    if (!approval) throw new Error('Native configuration authorization is unavailable');
    const policy = approval.overrideOf(agent.session) ?? approval.config.policy ?? 'ask';
    if (policy !== 'ask') throw new Error('Configuration authorization denied by host policy');
    const outcome = await approval.request({ agent, toolName: 'cross_config_save', signal, ...(callId ? { callId } : {}), reason: `Save cross-review ${plan.scope} configuration to ${plan.path}; ${plan.exists ? 'replace the existing file only if unchanged' : 'create a new file'}. Complete selection and effective configuration: ${JSON.stringify(plan)}. This confirms configuration only, not paid review or inference.` });
    if (outcome !== 'allowed-once') throw new Error(`Configuration authorization ${outcome}`);
    signal.throwIfAborted(); this.assertAgent(agent);
    await inspect(plan.path, true);
    // No directories or lock files are written before explicit native confirmation.
    await mkdir(dirname(plan.path), { recursive: true, mode: 0o700 });
    await inspect(plan.path, true);
    await inspect(`${plan.path}.lock`, true);
    return withFileLock(plan.path, async () => {
      signal.throwIfAborted(); this.assertAgent(agent);
      await inspect(plan.path, true);
      const previous = await readConfiguration(plan.path);
      if ((previous && digest(previous.bytes)) !== pending.previousDigest) throw new Error('Configuration changed since preview; preserve it and preview again');
      const effective = await this.effective(cwd, { scope: plan.scope, configuration: plan.configuration });
      if (effective.layersDigest !== pending.layersDigest || JSON.stringify(effective.config) !== JSON.stringify(plan.effectiveConfig)) throw new Error('Configuration layers changed since preview');
      await validateRoutes(this.ctx, plan.configuration); await validateRoutes(this.ctx, effective.config);
      signal.throwIfAborted(); this.assertAgent(agent);
      await inspect(plan.path, true);
      await writeFileAtomic(plan.path, `${JSON.stringify(plan.configuration, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
      // Failure is reported, never described as a successful setup; do not silently undo another writer.
      const result = await this.validate(agent, plan.scope);
      if (JSON.stringify(result.configuration) !== JSON.stringify(plan.configuration) || JSON.stringify(result.effectiveConfig) !== JSON.stringify(plan.effectiveConfig)) throw new Error('Post-write configuration mismatch');
      return result;
    });
  }
  async dispose(): Promise<void> {
    this.closing = true; this.pending.clear();
    this.shutdown.abort(new Error('Configuration service disposed'));
    await Promise.allSettled([...this.writes]);
  }
}
