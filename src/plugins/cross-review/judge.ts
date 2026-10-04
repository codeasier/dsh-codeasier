import { createHash } from 'node:crypto';
import type { Snapshot } from './evidence.js';
import { freezeRecursively, judgeDecisionSchema, reviewerResultSchema, type Finding, type JudgeDecision, type ReviewerResult } from './protocol.js';

/** Reviewer-local IDs never decide identity or correctness. */
export function canonicalFindingId(finding: Pick<Finding, 'path' | 'startLine' | 'endLine' | 'title' | 'quote'>): string {
  const identity = JSON.stringify([finding.path, finding.startLine, finding.endLine, finding.title, finding.quote]);
  return `finding-${createHash('sha256').update(identity).digest('hex')}`;
}

function evidenceError(finding: Finding, snapshot: Snapshot): string | undefined {
  const segments = finding.path.split('/');
  if (finding.path.startsWith('/') || finding.path.includes('\\') || /[\u0000-\u001f\u007f]/.test(finding.path) ||
      /^[a-zA-Z]:/.test(finding.path) || segments.some(part => part === '' || part === '.' || part === '..' || ['.git', '.hg', '.svn'].includes(part.toLowerCase()))) {
    return 'Finding path is not a safe snapshot-relative path';
  }
  if (!Object.hasOwn(snapshot.files, finding.path)) return 'Finding path is outside the immutable snapshot';
  const content = snapshot.files[finding.path];
  if (typeof content !== 'string') return 'Snapshot source text is unavailable';
  // A terminating newline is not an additional source line; normalize CRLF only
  // for line slicing, never trim or fuzzily match reviewer quotations.
  const lines = content.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
  if (lines.at(-1) === '') lines.pop();
  if (finding.startLine < 1 || finding.endLine < finding.startLine || finding.endLine > lines.length) return 'Finding line bounds are outside the immutable snapshot';
  const selected = lines.slice(finding.startLine - 1, finding.endLine).join('\n');
  if (!selected.includes(finding.quote)) return 'Finding quote does not exactly match the declared snapshot line range';
  return undefined;
}

export interface ConsolidatedResults {
  findings: Finding[];
  rejected: { findingId: string; reason: string }[];
  pending: Finding[];
}

/**
 * This pure reducer does not authorize callers. The host authenticates judgment
 * and cost policy before supplying decisions. Quotes establish evidence binding,
 * never correctness, and any number of matching reviewers still leaves pending.
 */
export function consolidateResults(results: readonly ReviewerResult[], snapshot: Snapshot, decisions: readonly JudgeDecision[]): ConsolidatedResults {
  const candidates = new Map<string, Finding>();
  for (const input of results) {
    const result = reviewerResultSchema.parse(input);
    for (const original of result.findings) {
      const id = canonicalFindingId(original);
      const finding = { ...original, id };
      const previous = candidates.get(id);
      // Deterministic representative, independent of reviewer order or count.
      if (!previous || JSON.stringify([finding.body, finding.severity]) < JSON.stringify([previous.body, previous.severity])) candidates.set(id, finding);
    }
  }
  const decisionMap = new Map<string, JudgeDecision>();
  for (const input of decisions) {
    const decision = judgeDecisionSchema.parse(input);
    if (!candidates.has(decision.findingId)) throw new Error(`Unknown judge finding ID: ${decision.findingId}`);
    if (decisionMap.has(decision.findingId)) throw new Error(`Duplicate judge decision: ${decision.findingId}`);
    decisionMap.set(decision.findingId, decision);
  }
  const output: ConsolidatedResults = { findings: [], rejected: [], pending: [] };
  for (const finding of [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const invalidEvidence = evidenceError(finding, snapshot);
    if (invalidEvidence) {
      output.rejected.push({ findingId: finding.id, reason: invalidEvidence });
      continue;
    }
    const decision = decisionMap.get(finding.id);
    if (!decision) {
      output.pending.push(finding);
    } else if (decision.verdict === 'rejected') {
      output.rejected.push({ findingId: finding.id, reason: decision.reason });
    } else {
      // An explicit verification endorses the candidate's severity when the
      // judge does not supply a recalibration; duplication never adjusts it.
      output.findings.push({ ...finding, severity: decision.severity ?? finding.severity });
    }
  }
  return freezeRecursively(output);
}
