import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { auditRun } from './audit.js';

export { auditRun, inspectAuditSnapshot } from './audit.js';
export type { AuditCheck, AuditResult, CheckResult, ReviewObservation } from './audit.js';
export const name = 'cross-review-audit';
export const inject = ['tools', 'crossReview'];
export const Config = schema.object({});
const configSchema = z.strictObject({});
const inputSchema = z.strictObject({ runId: z.string().uuid() });

/** Opt-in Host only: no scheduler, store, model, registry or TUI dependency. */
export function apply(ctx: Context, config: unknown): void {
  configSchema.parse(config);
  if (!ctx.get('tools', false) || !ctx.get('crossReview', false)) throw new Error('Cross-review audit dependency unavailable');
  let closed = false;
  const unregister = ctx.tools.register(defineTool({
    name: 'cross_review_audit',
    description: 'Owner-only read-only audit of one exact native cross-review run ID. Reports concrete facts and sources, distinguishing anomalies, insufficient evidence and unverifiable history. No paid calls, replay or controls.',
    parameters: { runId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (closed) throw new Error('Cross-review audit plugin disposed');
      const { runId } = inputSchema.parse(args);
      if (!exec.agent) throw new Error('Cross-review audit requires a live owning Agent');
      const service = ctx.get('crossReview', false);
      if (!service) throw new Error('Cross-review audit dependency unavailable');
      const result = await auditRun(service, exec.agent, runId, exec.signal);
      if (closed) throw new Error('Cross-review audit plugin disposed');
      return JSON.stringify(result);
    },
  }));
  ctx.effect(() => () => { closed = true; unregister(); });
}
