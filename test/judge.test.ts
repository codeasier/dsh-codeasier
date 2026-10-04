import assert from 'node:assert/strict';
import test from 'node:test';
import type { Snapshot } from '../src/evidence.js';
import { canonicalFindingId, consolidateResults } from '../src/judge.js';
import type { Finding } from '../src/protocol.js';

// This reducer reads only immutable source text; target metadata is exercised by
// the separate evidence binding tests rather than manufactured filesystem state.
const snapshot = {
  id: 'snapshot-test', version: 1, files: { 'src/main.ts': 'const trusted = true;\nrun(trusted);\n' },
  diff: '', notes: [], createdAt: 1,
} as unknown as Snapshot;
const finding: Finding = {
  id: 'reviewer-local', title: 'Unchecked execution', body: 'Explain a concrete risk.', severity: 'high',
  path: 'src/main.ts', startLine: 2, endLine: 2, quote: 'run(trusted);',
};

test('even unanimous reviewer output never automatically verifies correctness', () => {
  const merged = consolidateResults([{ findings: [finding] }, { findings: [{ ...finding, id: 'other' }] }], snapshot, []);
  assert.equal(merged.findings.length, 0);
  assert.equal(merged.pending.length, 1);
  assert.equal(merged.pending[0]!.id, canonicalFindingId(finding));
  assert.deepEqual(merged.rejected, []);
});

test('exact semantic duplicates have stable IDs and deterministic representatives', () => {
  const other = { ...finding, id: 'different-local', body: 'Another concrete risk.', severity: 'critical' as const };
  const left = consolidateResults([{ findings: [finding] }, { findings: [other] }], snapshot, []);
  const right = consolidateResults([{ findings: [other] }, { findings: [finding] }], snapshot, []);
  assert.deepEqual(left, right);
  assert.equal(left.pending.length, 1);
  assert.equal(canonicalFindingId(other), canonicalFindingId(finding));
  assert.notEqual(canonicalFindingId({ ...finding, title: 'Different claim' }), canonicalFindingId(finding));
});

test('verified decisions require independently valid bounds and exact snapshot quote', () => {
  const cases = [
    { ...finding, path: '../src/main.ts' },
    { ...finding, path: '/src/main.ts' },
    { ...finding, path: 'src\\main.ts' },
    { ...finding, path: 'src/../src/main.ts' },
    { ...finding, path: '.git/config' },
    { ...finding, path: 'src/absent.ts' },
    { ...finding, startLine: 3, endLine: 3 },
    { ...finding, startLine: 1, endLine: 1 },
    { ...finding, quote: 'run(untrusted);' },
  ];
  for (const invalid of cases) {
    const output = consolidateResults([{ findings: [invalid] }], snapshot, [{ findingId: canonicalFindingId(invalid), verdict: 'verified', reason: 'Judge claimed true', severity: 'critical' }]);
    assert.equal(output.findings.length, 0);
    assert.equal(output.pending.length, 0);
    assert.equal(output.rejected.length, 1);
  }
});

test('explicit verification accepts evidence and calibrates severity without votes', () => {
  const id = canonicalFindingId(finding);
  const output = consolidateResults([{ findings: [finding] }], snapshot, [{ findingId: id, verdict: 'verified', reason: 'Independent analysis confirmed the failure path.', severity: 'low' }]);
  assert.deepEqual(output.findings, [{ ...finding, id, severity: 'low' }]);
  assert.deepEqual(output.pending, []);
  assert.deepEqual(output.rejected, []);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.findings[0]), true);
});

test('explicit rejection is recorded and missing decisions remain pending', () => {
  const second = { ...finding, id: 'second', title: 'Another issue' };
  const id = canonicalFindingId(finding);
  const output = consolidateResults([{ findings: [finding, second] }], snapshot, [{ findingId: id, verdict: 'rejected', reason: 'The caller already validates input.' }]);
  assert.deepEqual(output.rejected, [{ findingId: id, reason: 'The caller already validates input.' }]);
  assert.equal(output.pending[0]!.id, canonicalFindingId(second));
  assert.equal(output.findings.length, 0);
});

test('unknown, reviewer-local, malformed and duplicate judge decisions reject', () => {
  const decision = { findingId: canonicalFindingId(finding), verdict: 'verified' as const, reason: 'Evidence checked' };
  assert.throws(() => consolidateResults([{ findings: [finding] }], snapshot, [{ ...decision, findingId: 'unknown' }]), /Unknown/);
  assert.throws(() => consolidateResults([{ findings: [finding] }], snapshot, [{ ...decision, findingId: finding.id }]), /Unknown/);
  assert.throws(() => consolidateResults([{ findings: [finding] }], snapshot, [decision, decision]), /Duplicate/);
  assert.throws(() => consolidateResults([{ findings: [finding] }], snapshot, [{ ...decision, reason: '' }]));
});

test('source prototypes are not snapshot evidence and inputs are not mutated', () => {
  const inherited = { ...snapshot, files: Object.create({ 'src/main.ts': 'run(trusted);' }) } as Snapshot;
  const output = consolidateResults([{ findings: [finding] }], inherited, []);
  assert.equal(output.rejected.length, 1);
  assert.equal(finding.id, 'reviewer-local');
  assert.equal(Object.isFrozen(finding), false);
  assert.deepEqual(consolidateResults([], snapshot, []), { findings: [], rejected: [], pending: [] });
});
