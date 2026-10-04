import assert from 'node:assert/strict';
import test from 'node:test';
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { configSchema, judgeDecisionSchema, judgeResultSchema, JUDGE_SCHEMA, parseConfig, REVIEWER_SCHEMA, reviewerResultSchema } from '../src/protocol.js';

const reviewer = { id: 'security', provider: 'mock', model: 'mock-explicit', focus: 'security' };

test('reviewers are explicit; defaults are conservative and sourced', () => {
  const parsed = parseConfig([{ source: 'project', value: { reviewers: [reviewer] } }]);
  assert.equal(parsed.config.concurrency, 2);
  assert.equal(parsed.config.timeoutMs, 120_000);
  assert.deepEqual(parsed.config.judge, { kind: 'parent' });
  assert.equal(parsed.sources.concurrency, 'default');
  assert.equal(parsed.sources['reviewers.0.model'], 'project');
  assert.throws(() => parseConfig([]));
  assert.throws(() => parseConfig([{ source: 'project', value: { reviewers: [{ id: 'x', provider: 'mock', focus: 'bugs' }] } }]));
});

test('layer order, judge deep merging, array replacement, and provenance are exact', () => {
  const next = { ...reviewer, id: 'correctness' };
  const { config, sources } = parseConfig([
    { source: 'project', value: { reviewers: [reviewer], concurrency: 3, judge: { kind: 'model', provider: 'mock', model: 'judge-a', maxTokens: 100 } } },
    { source: 'session', value: { timeoutMs: 4000, judge: { model: 'judge-b' } } },
    { source: 'invocation', value: { reviewers: [next], concurrency: 1 } },
  ]);
  assert.deepEqual(config.reviewers, [next]);
  assert.deepEqual(config.judge, { kind: 'model', provider: 'mock', model: 'judge-b', maxTokens: 100 });
  assert.equal(config.concurrency, 1);
  assert.equal(sources['judge.provider'], 'project');
  assert.equal(sources['judge.model'], 'session');
  assert.equal(sources.timeoutMs, 'session');
  assert.equal(sources.reviewers, 'invocation');
  assert.equal(sources['reviewers.0.id'], 'invocation');
});

test('switching model judgment to parent drops obsolete model provenance', () => {
  const { config, sources } = parseConfig([
    { source: 'project', value: { reviewers: [reviewer], judge: { kind: 'model', provider: 'mock', model: 'judge' } } },
    { source: 'invocation', value: { judge: { kind: 'parent' } } },
  ]);
  assert.deepEqual(config.judge, { kind: 'parent' });
  assert.equal(sources['judge.kind'], 'invocation');
  assert.equal(sources['judge.model'], undefined);
});

test('reject unknowns, duplicate reviewer ids, wrong routes, and numeric mistakes', () => {
  for (const value of [
    { reviewers: [reviewer], extra: true },
    { reviewers: [reviewer, reviewer] },
    { reviewers: [{ ...reviewer, model: '' }] },
    { reviewers: [{ ...reviewer, model: ' ' }] },
    { reviewers: [{ ...reviewer, provider: ' mock' }] },
    { reviewers: [{ ...reviewer, inheritedHistory: true }] },
    { reviewers: [reviewer], concurrency: 0 },
    { reviewers: [reviewer], concurrency: 1.5 },
    { reviewers: [reviewer], timeoutMs: NaN },
    { reviewers: [reviewer], timeoutMs: Infinity },
    { reviewers: [reviewer], concurrency: undefined },
    { reviewers: [reviewer], judge: { kind: 'parent', provider: 'mock' } },
    { reviewers: [reviewer], judge: { kind: 'model', provider: 'mock' } },
  ]) assert.throws(() => parseConfig([{ source: 'bad', value }]));
  assert.throws(() => configSchema.parse({ reviewers: [reviewer], concurrency: 1, timeoutMs: 1, judge: { kind: 'parent' }, extra: true }));
});

test('returned configuration and provenance are deeply immutable and detached', () => {
  const input = { reviewers: [{ ...reviewer }], judge: { kind: 'model', provider: 'mock', model: 'judge' } };
  const { config, sources } = parseConfig([{ source: 'project', value: input }]);
  input.reviewers[0]!.model = 'mutated';
  assert.equal(config.reviewers[0]!.model, 'mock-explicit');
  for (const node of [config, config.reviewers, config.reviewers[0], config.judge, sources]) assert.equal(Object.isFrozen(node), true);
  assert.throws(() => { config.reviewers[0]!.model = 'wrong'; });
});

test('native schemas obey enforced object-root subset and reject extra props', () => {
  assertObjectJsonSchema(REVIEWER_SCHEMA);
  assertObjectJsonSchema(JUDGE_SCHEMA);
  assert.deepEqual(validateJsonSchemaValue(REVIEWER_SCHEMA, { findings: [] }), []);
  assert.deepEqual(validateJsonSchemaValue(JUDGE_SCHEMA, { decisions: [] }), []);
  assert.ok(validateJsonSchemaValue(REVIEWER_SCHEMA, { findings: [], extra: true }).length > 0);
  assert.ok(validateJsonSchemaValue(JUDGE_SCHEMA, { decisions: [{ findingId: 'x', verdict: 'verified', reason: 'why', extra: true }] }).length > 0);
  assert.deepEqual(reviewerResultSchema.parse({ findings: [] }), { findings: [] });
  assert.deepEqual(judgeResultSchema.parse({ decisions: [] }), { decisions: [] });
  assert.throws(() => judgeDecisionSchema.parse({ findingId: 'x', verdict: 'majority', reason: 'votes' }));
  assert.throws(() => reviewerResultSchema.parse({ findings: [], extra: true }));
});
