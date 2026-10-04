import { z } from 'zod';
import { configSchema, reviewerResultSchema, judgeDecisionSchema, type Finding } from './protocol.js';
import { validateSnapshot } from './evidence.js';
import { consolidateResults } from './judge.js';

export const runStateSchema = z.enum(['running', 'awaiting_timeout', 'awaiting_judge', 'completed', 'failed', 'cancelled', 'interrupted']);
export const attemptSchema = z.strictObject({
  id: z.string().min(1), reviewerId: z.string().min(1), provider: z.string().min(1), model: z.string().min(1),
  kind: z.enum(['reviewer', 'judge']), state: z.enum(['pending', 'provisioning', 'running', 'completed', 'failed', 'aborted', 'interrupted']),
  controllerId: z.string().optional(), childId: z.string().optional(), snapshotId: z.string().optional(),
  result: reviewerResultSchema.optional(), decisions: z.array(judgeDecisionSchema).optional(), diagnostic: z.string().optional(),
});
export const runRecordSchema = z.strictObject({
  id: z.string().uuid(), revision: z.number().int().nonnegative(), schemaVersion: z.literal(1), policyVersion: z.literal(1),
  owner: z.strictObject({ sessionId: z.string().min(1), project: z.string().min(1), runtimeId: z.string().uuid(), workspaceCwd: z.string().min(1).optional() }),
  config: configSchema, sources: z.record(z.string(), z.string()),
  snapshot: z.unknown().transform(validateSnapshot), state: runStateSchema,
  attempts: z.array(attemptSchema), decisions: z.array(judgeDecisionSchema),
  authorization: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(['interactive', 'headless']), outcome: z.literal('allowed-once'), approvedAt: z.number().int().nonnegative(), approvalPolicy: z.literal('ask') }),
  cancellationIntent: z.boolean(), deadline: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  audit: z.array(z.strictObject({ at: z.number().int().nonnegative(), action: z.string().min(1), detail: z.string() })),
  failure: z.string().optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;
export type AttemptRecord = z.infer<typeof attemptSchema>;
export type RunState = z.infer<typeof runStateSchema>;
export interface ReviewReport {
  runId: string;
  revision: number;
  state: RunState;
  complete: boolean;
  snapshotId: string;
  findings: Finding[];
  pending: Finding[];
  rejected: { findingId: string; reason: string }[];
  reviewerCompleted: number;
  reviewerRequired: number;
  audit: RunRecord['audit'];
}
export const terminal = (state: RunState): boolean => ['completed', 'failed', 'cancelled'].includes(state);

export function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export function parseRecord(value: unknown): RunRecord {
  const record = runRecordSchema.parse(value);
  const ids = new Set<string>();
  const children = new Set<string>();
  const reviewers = new Set<string>();
  for (const attempt of record.attempts) {
    if (ids.has(attempt.id)) throw new Error('Duplicate durable attempt identity');
    ids.add(attempt.id);
    if (attempt.childId) {
      if (children.has(attempt.childId) || attempt.snapshotId !== record.snapshot.id || !attempt.controllerId) throw new Error('Invalid durable evidence binding');
      children.add(attempt.childId);
    }
    if (attempt.state === 'completed' && (!attempt.childId || (attempt.kind === 'reviewer' ? !attempt.result : !attempt.decisions))) throw new Error('Unconfirmed durable completion');
    if (attempt.kind === 'reviewer') {
      if (reviewers.has(attempt.reviewerId)) throw new Error('Duplicate durable reviewer identity');
      reviewers.add(attempt.reviewerId);
      if (attempt.decisions || !record.config.reviewers.some(r => r.id === attempt.reviewerId && r.provider === attempt.provider && r.model === attempt.model)) throw new Error('Durable reviewer route mismatch');
    } else {
      const judge = record.config.judge;
      if (attempt.result || judge.kind !== 'model' || attempt.provider !== judge.provider || attempt.model !== judge.model) throw new Error('Durable judge route mismatch');
    }
  }
  if (record.state === 'completed') {
    const count = record.attempts.filter(a => a.kind === 'reviewer' && a.state === 'completed').length;
    if (record.cancellationIntent || count < Math.floor(record.config.reviewers.length / 2) + 1) throw new Error('Invalid durable quorum completion');
    const report = consolidateResults(record.attempts.filter(a => a.kind === 'reviewer' && a.state === 'completed').map(a => a.result!), record.snapshot, record.decisions);
    if (report.pending.length) throw new Error('Durable completion has pending independent judgment');
  }
  return immutable(record);
}
