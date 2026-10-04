import { z } from 'zod';
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';

export const SCHEMA_VERSION = 1;
export const POLICY_VERSION = 1;

const nonblank = z.string().min(1).refine(value => value.trim().length > 0, 'Must not be blank');
const route = nonblank.refine(value => value === value.trim(), 'Route must not have surrounding whitespace');
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const reviewerSchema = z.strictObject({
  id: route,
  provider: route,
  model: route,
  focus: nonblank,
  maxTokens: positiveInteger.optional(),
});
export type Reviewer = z.infer<typeof reviewerSchema>;

const judgeConfigSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('parent') }),
  z.strictObject({ kind: z.literal('model'), provider: route, model: route, maxTokens: positiveInteger.optional() }),
]);
export const configSchema = z.strictObject({
  reviewers: z.array(reviewerSchema).min(1).superRefine((reviewers, ctx) => {
    const ids = new Set<string>();
    reviewers.forEach((reviewer, index) => {
      if (ids.has(reviewer.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate reviewer id' });
      ids.add(reviewer.id);
    });
  }),
  concurrency: positiveInteger,
  timeoutMs: positiveInteger,
  judge: judgeConfigSchema,
});
export type ReviewConfig = z.infer<typeof configSchema>;
export interface ConfigLayer { readonly source: string; readonly value: unknown }

const judgeLayerSchema = z.union([
  z.strictObject({ kind: z.literal('parent') }),
  z.strictObject({ kind: z.literal('model').optional(), provider: route.optional(), model: route.optional(), maxTokens: positiveInteger.optional() }),
]);
const layerSchema = configSchema.partial().extend({ judge: judgeLayerSchema.optional() });

/** Freeze every owned node; never freezes or retains the caller's input objects. */
export function freezeRecursively<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}

/** Later layers win; reviewer arrays replace, while model judge fields merge. */
export function parseConfig(layers: readonly ConfigLayer[]): { config: ReviewConfig; sources: Readonly<Record<string, string>> } {
  const merged: Record<string, unknown> = { concurrency: 2, timeoutMs: 120_000, judge: { kind: 'parent' } };
  const sources: Record<string, string> = { concurrency: 'default', timeoutMs: 'default', judge: 'default', 'judge.kind': 'default' };
  for (const layer of layers) {
    route.parse(layer.source);
    const parsed = layerSchema.parse(layer.value);
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) throw new Error(`Undefined configuration field: ${layer.source}:${key}`);
      if (key === 'judge') {
        const incoming = value as Record<string, unknown>;
        const previous = merged.judge as Record<string, unknown>;
        const changedKind = incoming.kind !== undefined && incoming.kind !== previous.kind;
        if (changedKind || incoming.kind === 'parent') {
          for (const sourceKey of Object.keys(sources)) if (sourceKey.startsWith('judge.')) delete sources[sourceKey];
          merged.judge = { ...incoming };
        } else {
          merged.judge = { ...previous, ...incoming };
        }
        sources.judge = layer.source;
        for (const field of Object.keys(incoming)) sources[`judge.${field}`] = layer.source;
      } else {
        merged[key] = value;
        sources[key] = layer.source;
        if (key === 'reviewers') {
          for (const sourceKey of Object.keys(sources)) if (sourceKey.startsWith('reviewers.')) delete sources[sourceKey];
          (value as Reviewer[]).forEach((reviewer, index) => {
            for (const field of Object.keys(reviewer)) sources[`reviewers.${index}.${field}`] = layer.source;
          });
        }
      }
    }
  }
  return { config: freezeRecursively(configSchema.parse(merged)), sources: Object.freeze(sources) };
}

export const findingSchema = z.strictObject({
  id: nonblank,
  title: nonblank,
  body: nonblank,
  severity: severitySchema,
  path: nonblank,
  startLine: positiveInteger,
  endLine: positiveInteger,
  quote: nonblank,
}).refine(value => value.endLine >= value.startLine, { path: ['endLine'], message: 'endLine precedes startLine' });
export type Finding = z.infer<typeof findingSchema>;
export const reviewerResultSchema = z.strictObject({ findings: z.array(findingSchema) });
export type ReviewerResult = z.infer<typeof reviewerResultSchema>;
export const judgeDecisionSchema = z.strictObject({
  findingId: nonblank,
  verdict: z.enum(['verified', 'rejected']),
  reason: nonblank,
  severity: severitySchema.optional(),
});
export type JudgeDecision = z.infer<typeof judgeDecisionSchema>;
export const judgeResultSchema = z.strictObject({ decisions: z.array(judgeDecisionSchema) });
export type JudgeResult = z.infer<typeof judgeResultSchema>;

/** Native dsh-tools structured-output subset: no unsupported validation keywords. */
export const REVIEWER_SCHEMA = freezeRecursively({
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          path: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, quote: { type: 'string' },
        },
        required: ['id', 'title', 'body', 'severity', 'path', 'startLine', 'endLine', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} satisfies ObjectJsonSchema);
export const JUDGE_SCHEMA = freezeRecursively({
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' }, verdict: { type: 'string', enum: ['verified', 'rejected'] },
          reason: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['findingId', 'verdict', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} satisfies ObjectJsonSchema);
