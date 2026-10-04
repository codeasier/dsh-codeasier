import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { z as validate } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import { CrossReviewService, type Control } from './service.js';
import { openReviewStore } from './store.js';
import { readEvidence, type EvidenceTarget } from './evidence.js';
import type { ReviewReport } from './records.js';
import { judgeDecisionSchema } from './protocol.js';

export { CrossReviewService } from './service.js';
export type { ReviewPlan, Control, ServiceOptions } from './service.js';
export type { ReviewConfig, Reviewer, Finding, ReviewerResult, JudgeDecision } from './protocol.js';
export type { RunRecord, ReviewReport } from './records.js';
export type { Snapshot, EvidenceTarget } from './evidence.js';
declare module '@deepseek-ai/cordis' { interface Context { crossReview: CrossReviewService } }
export const name = 'cross-review';
export const inject = ['agents', 'llm', 'tools', 'subagents', 'storage'];
export const Config = z.object({ root: z.string().required(), review: z.any().default({}), preauthorizedDigests: z.array(z.string()).default([]) });
const hostConfig = validate.strictObject({ root: validate.string().min(1), review: validate.unknown().default({}), preauthorizedDigests: validate.array(validate.string().regex(/^[a-f0-9]{64}$/)).default([]) });
const previewInput = validate.strictObject({ target: validate.unknown().optional(), configuration: validate.unknown().optional(), notes: validate.array(validate.string()).optional(), pack: validate.record(validate.string(), validate.string()).optional() });
const controlSchema = validate.strictObject({ runId: validate.string().uuid(), expectedRevision: validate.number().int().nonnegative() });
const owner = (agent: Agent | undefined): Agent => { if (!agent) throw new Error('Cross-review requires a live owning Agent'); return agent; };
const textOutput = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] };

async function preview(service: CrossReviewService, agent: Agent, raw: unknown) {
  const input = previewInput.parse(raw);
  const target = input.target ?? { kind: 'local', root: agent.session.header.cwd };
  const plan = await service.preview(agent, target as EvidenceTarget, input.configuration === undefined ? [] : [{ source: 'invocation', value: input.configuration }], { notes: input.notes, pack: input.pack });
  return { planId: plan.id, authorizationDigest: plan.digest, expiresAt: plan.expiresAt, config: plan.config, sources: plan.sources, snapshotId: plan.snapshot.id, target: plan.snapshot.target, provenance: plan.snapshot.provenance, fileCount: Object.keys(plan.snapshot.files).length, diffBytes: Buffer.byteLength(plan.snapshot.diff), authorization: 'No models have been called. Startup requires native open-turn approval; approval never rejects.' };
}

/** Optional TUI uses this exact definition through its mediated public host. */
export function createReviewCommand(service: CrossReviewService, onReport?: (report: ReviewReport) => void): CommandDefinition {
  return {
    name: 'review', description: 'Preview, start, inspect, judge, cancel, preserve, or clean a native cross-review run.',
    recordInput: false,
    handler: async invocation => {
      try {
        invocation.signal.throwIfAborted();
        const parsed = /^(\S+)(?:\s+([\s\S]*))?$/.exec(invocation.rawInput.trim());
        const action = parsed?.[1] ?? '';
        const payload = parsed?.[2] ?? '';
        const tail = payload.trim() ? payload.trim().split(/\s+/) : [];
        if (!action || action === 'help') return { kind: 'success', text: 'review preview <JSON request> | start <planId> | list | status/report <runId> | cancel/preserve/abort/cleanup <runId> <revision> | judge <JSON {runId,expectedRevision,decisions}>. Idle start is rejected: ask the parent to call cross_review_start in an open turn. No automatic paid continuation.' };
        let value: unknown;
        if (action === 'preview') value = await preview(service, invocation.agent, JSON.parse(payload || '{}'));
        else if (action === 'list' && !tail.length) value = (await service.list(invocation.agent)).map(r => ({ runId: r.id, revision: r.revision, state: r.state, snapshotId: r.snapshot.id }));
        else if (action === 'start' && tail.length === 1) { const run = await service.start(invocation.agent, tail[0]!, invocation.signal); value = { runId: run.id, revision: run.revision, state: run.state }; }
        else if (action === 'status' && tail.length === 1) { const run = await service.status(invocation.agent, tail[0]!); value = { ...run, snapshot: { id: run.snapshot.id, target: run.snapshot.target, provenance: run.snapshot.provenance } }; }
        else if (action === 'report' && tail.length === 1) { const report = await service.report(invocation.agent, tail[0]!); onReport?.(report); value = report; }
        else if (action === 'judge') {
          const input = validate.strictObject({ runId: validate.string().uuid(), expectedRevision: validate.number().int().nonnegative(), decisions: validate.array(validate.unknown()) }).parse(JSON.parse(payload));
          // The service validates each decision and independently checks snapshot
          // quotations; this command never interprets votes as correctness.
          value = await service.judge(invocation.agent, input, input.decisions as Parameters<CrossReviewService['judge']>[2]);
        } else if (['cancel', 'preserve', 'abort', 'cleanup'].includes(action) && tail.length === 2) {
          const control = controlSchema.parse({ runId: tail[0], expectedRevision: Number(tail[1]) });
          if (action === 'cancel') value = await service.cancel(invocation.agent, control);
          else if (action === 'cleanup') { await service.cleanup(invocation.agent, control); value = { removed: control.runId }; }
          else value = await service.decideTimeout(invocation.agent, control, action === 'preserve' ? 'preserve' : 'abort');
        } else throw new Error('Invalid review command; use review help');
        // Run receipts do not echo complete snapshot contents into the UI log.
        if (value && typeof value === 'object' && 'snapshot' in value) { const run = value as Awaited<ReturnType<CrossReviewService['status']>>; value = { ...run, snapshot: { id: run.snapshot.id, target: run.snapshot.target } }; }
        return { kind: 'success', text: JSON.stringify(value, null, 2) };
      } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : 'Cross-review command failed' }; }
    },
  };
}

export async function apply(ctx: Context, rawConfig: unknown): Promise<void> {
  const config = hostConfig.parse(rawConfig);
  const store = await openReviewStore(ctx, config.root);
  let service: CrossReviewService | undefined;
  try {
    service = new CrossReviewService(ctx, store, { configLayers: [{ source: 'host-plugin', value: config.review }], preauthorizedDigests: config.preauthorizedDigests });
    await service.recover();
    const backend = service;
    const withdraw = ctx.provide('crossReview', backend);
    const registrations: (() => void)[] = [];
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_preview', description: 'Validate reviewer/model configuration and prepare immutable evidence without paid model calls. request: {target?,configuration?,notes?,pack?}. Default target is owning local workspace.',
      parameters: { request: { type: 'json', required: true } }, output: textOutput,
      async execute(args, exec) { exec.signal.throwIfAborted(); return JSON.stringify(await preview(backend, owner(exec.agent), args.request)); },
    })));
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_status', description: 'Read a durable run status without scheduling work.',
      parameters: { runId: { type: 'string', required: true } }, output: textOutput,
      async execute(args, exec) { const run = await backend.status(owner(exec.agent), args.runId); return JSON.stringify({ ...run, snapshot: { id: run.snapshot.id, target: run.snapshot.target, provenance: run.snapshot.provenance } }); },
    })));
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_report', description: 'Read verified findings and pending decisions. Only complete:true is a completed review.',
      parameters: { runId: { type: 'string', required: true } }, output: textOutput,
      async execute(args, exec) { return JSON.stringify(await backend.report(owner(exec.agent), args.runId)); },
    })));
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_evidence', description: 'Read owning-run immutable evidence for independent parent judging; use kind file/diff/notes.',
      parameters: { runId: { type: 'string', required: true }, kind: { type: 'string', enum: ['file', 'diff', 'notes'], required: true }, path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, output: textOutput,
      async execute(args, exec) {
        const run = await backend.status(owner(exec.agent), args.runId);
        if (args.kind === 'file') return JSON.stringify(readEvidence(run.snapshot, args.path ?? '', args.offset ?? 1, args.limit ?? 200));
        if (args.kind === 'notes') return JSON.stringify({ snapshotId: run.snapshot.id, notes: run.snapshot.notes });
        const offset = args.offset ?? 1, limit = args.limit ?? 200;
        if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error('Invalid evidence page');
        const lines = run.snapshot.diff.split('\n');
        return JSON.stringify({ totalLines: lines.length, lines: lines.slice(offset - 1, offset - 1 + limit).map((text, i) => ({ number: offset + i, text })) });
      },
    })));
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_control', description: 'Revision-checked owner-only cancel/preserve/abort/cleanup. Cleanup removes only a quiescent terminal report and its snapshot.',
      parameters: { runId: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true }, action: { type: 'string', enum: ['cancel', 'preserve', 'abort', 'cleanup'], required: true } }, output: textOutput,
      async execute(args, exec) {
        const control: Control = controlSchema.parse({ runId: args.runId, expectedRevision: args.expectedRevision });
        const agent = owner(exec.agent);
        if (args.action === 'cleanup') { await backend.cleanup(agent, control); return JSON.stringify({ removed: args.runId }); }
        const run = args.action === 'cancel' ? await backend.cancel(agent, control) : await backend.decideTimeout(agent, control, args.action === 'preserve' ? 'preserve' : 'abort');
        return JSON.stringify({ runId: run.id, revision: run.revision, state: run.state });
      },
    })));
    registrations.push(ctx.tools.register(defineTool({
      name: 'cross_review_judge', description: 'Submit independently verified parent-session verdicts for canonical pending finding IDs. decisions must be array of {findingId,verdict,reason,severity?}; quoted evidence is checked, votes ignored.',
      parameters: { runId: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true }, decisions: { type: 'json', required: true } }, output: textOutput,
      async execute(args, exec) {
        if (!Array.isArray(args.decisions)) throw new Error('Judge decisions must be an array');
        const control = controlSchema.parse({ runId: args.runId, expectedRevision: args.expectedRevision });
        const run = await backend.judge(owner(exec.agent), control, judgeDecisionSchema.array().parse(args.decisions));
        return JSON.stringify({ runId: run.id, revision: run.revision, state: run.state });
      },
    })));
    const commands = ctx.get('commands', false);
    // In a TUI host, only the optional mediated adapter owns this command.
    if (commands && !ctx.get('tuiPluginHost', false)) registrations.push(commands.register(createReviewCommand(backend)));
    ctx.effect(() => async () => {
      for (const unregister of registrations.reverse()) unregister();
      try { await backend.dispose(); } finally { withdraw(); }
    });
  } catch (error) {
    if (service) await service.dispose(); else await store.close();
    throw error;
  }
}
