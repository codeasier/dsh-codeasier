// DSH-native audit semantics inspired by codeasier/open-codeasier at
// 20194ff7a7b26fd51965e50bdb5091cb37a4c0f5 (MIT). See plugin attribution.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CrossReviewService } from '../cross-review/service.js';
import { immutable, parseRecord, runRecordSchema, type ReviewReport } from '../cross-review/records.js';
import { consolidateResults } from '../cross-review/judge.js';

/** Only the existing owner-validated observation methods; no control/store API. */
export type ReviewObservation = Pick<CrossReviewService, 'status' | 'report'>;
export type CheckResult = 'pass' | 'anomaly' | 'insufficient-evidence' | 'cannot-verify';
export interface AuditCheck {
  id: string;
  result: CheckResult;
  detail: string;
  sources: string[];
  facts: unknown;
}
export interface AuditResult {
  contractVersion: 1;
  binding: { runId: string | null; revision: number | null; snapshotId: string | null };
  reportBinding?: { runId: string; revision: number; snapshotId: string };
  checks: AuditCheck[];
  summary: Record<CheckResult, number>;
}

/** Pure checker, NOT an authorization or alternate storage reader. Raw abnormal
 * fixtures exercise diagnostics only; the production store rejects them first. */
export function inspectAuditSnapshot(input: { record: unknown; report?: ReviewReport; reportError?: string }): AuditResult {
  const checks: AuditCheck[] = [];
  const raw = input.record && typeof input.record === 'object' ? input.record as Record<string, unknown> : {};
  const snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot as Record<string, unknown> : {};
  const binding = { runId: typeof raw.id === 'string' ? raw.id : null, revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) ? raw.revision : null, snapshotId: typeof snapshot.id === 'string' ? snapshot.id : null };
  const add = (id: string, result: CheckResult, detail: string, sources: string[], facts: unknown) => { checks.push({ id, result, detail, sources, facts }); };
  const test = (id: string, condition: boolean, detail: string, sources: string[], facts: unknown) => add(id, condition ? 'pass' : 'anomaly', detail, sources, facts);
  const finish = (): AuditResult => immutable({ contractVersion: 1, binding,
    ...(input.report ? { reportBinding: { runId: input.report.runId, revision: input.report.revision, snapshotId: input.report.snapshotId } } : {}), checks,
    summary: Object.fromEntries(['pass', 'anomaly', 'insufficient-evidence', 'cannot-verify'].map(result => [result, checks.filter(c => c.result === result).length])) as AuditResult['summary'] });
  if (raw.schemaVersion !== 1 || raw.policyVersion !== 1) {
    add('contract.version', 'cannot-verify', 'Only persisted schemaVersion=1 and policyVersion=1 are supported; no older/newer contract is guessed.', ['status.schemaVersion', 'status.policyVersion'], { schemaVersion: raw.schemaVersion ?? null, policyVersion: raw.policyVersion ?? null });
    return finish();
  }
  add('contract.version', 'pass', 'Known persisted DSH contract.', ['status.schemaVersion', 'status.policyVersion'], { schemaVersion: 1, policyVersion: 1 });
  let record;
  try { record = runRecordSchema.parse(input.record); }
  catch (error) {
    add('record.validation', 'anomaly', 'Supplied pure-checker fixture fails record shape or immutable evidence validation; a real store rejects this before observation.', ['runRecordSchema', 'validateSnapshot'], { error: error instanceof Error ? error.message : 'Validation failed' });
    return finish();
  }
  try { parseRecord(record); add('record.validation', 'pass', 'Existing semantic record validator accepts this observation.', ['parseRecord'], { runId: record.id }); }
  catch (error) { add('record.validation', 'anomaly', 'Supplied fixture fails existing semantic validation; production observation must not bypass this validator.', ['parseRecord'], { error: error instanceof Error ? error.message : 'Validation failed' }); }
  const reviewers = record.attempts.filter(a => a.kind === 'reviewer');
  const judges = record.attempts.filter(a => a.kind === 'judge');
  const completed = reviewers.filter(a => a.state === 'completed' && a.result);
  const required = Math.floor(record.config.reviewers.length / 2) + 1;
  const attempts = record.attempts.map(a => ({ attemptId: a.id, reviewerId: a.reviewerId, kind: a.kind, state: a.state, childId: a.childId ?? null, controllerId: a.controllerId ?? null, snapshotId: a.snapshotId ?? null, provider: a.provider, model: a.model }));
  test('attempt.identities', new Set(record.attempts.map(a => a.id)).size === record.attempts.length && new Set(record.attempts.flatMap(a => a.childId ? [a.childId] : [])).size === record.attempts.filter(a => a.childId).length && new Set(reviewers.map(a => a.reviewerId)).size === reviewers.length && record.config.reviewers.every(r => reviewers.some(a => a.reviewerId === r.id)) && judges.length <= 1,
    'Each configured reviewer has one attempt; attempt and exact native child identities are unique; at most one paid judge attempt.', ['status.attempts', 'status.config.reviewers'], attempts);
  test('attempt.binding', new Set(record.attempts.flatMap(a => a.controllerId ? [a.controllerId] : [])).size === record.attempts.filter(a => a.controllerId).length && record.attempts.every(a => (!a.childId || (!!a.controllerId && a.childId !== a.controllerId && a.childId !== record.owner.sessionId && a.snapshotId === record.snapshot.id)) && (!['running', 'completed'].includes(a.state) || !!a.childId) && (a.state !== 'completed' || (a.kind === 'reviewer' ? !!a.result : !!a.decisions))),
    'Running/completed attempts require exact child, controller and snapshot binding; terminal results must be confirmed.', ['status.attempts', 'status.snapshot.id'], { snapshotId: record.snapshot.id, attempts });
  test('attempt.routes', record.attempts.every(a => a.kind === 'reviewer' ? !a.decisions && record.config.reviewers.some(r => r.id === a.reviewerId && r.provider === a.provider && r.model === a.model) : !a.result && record.config.judge.kind === 'model' && a.provider === record.config.judge.provider && a.model === record.config.judge.model),
    'Recorded attempt provider/model pairs must exactly match the frozen reviewer or explicit model-judge route.', ['status.attempts', 'status.config'], { attempts, routes: record.config });
  add('attempt.history', 'cannot-verify', 'Stored child IDs are exact native identities, not current registry membership. Completed children are normally released. Historical session contents, executed requests and tool use are not exposed by these observation methods.', ['CrossReviewService.status', 'NativeReviewerDriver.dispose'], { children: attempts.map(a => ({ attemptId: a.attemptId, childId: a.childId, state: a.state })), registryQueried: false, sessionContentsRead: false });
  add('evidence.identity', 'pass', 'Snapshot content hash, safe paths and provenance validated by the existing snapshot validator; audit does not read workspace files.', ['status.snapshot', 'validateSnapshot'], { snapshotId: record.snapshot.id, target: record.snapshot.target, provenance: record.snapshot.provenance, fileCount: Object.keys(record.snapshot.files).length });
  const digest = createHash('sha256').update(JSON.stringify({ project: record.owner.project, config: record.config, snapshotId: record.snapshot.id, schemaVersion: record.schemaVersion, policyVersion: record.policyVersion })).digest('hex');
  test('authorization.digest', record.authorization.digest === digest, 'Recorded one-shot authorization must bind the frozen project, config, snapshot and contract versions.', ['status.authorization', 'CrossReviewService.preview'], { recordedDigest: record.authorization.digest, recomputedDigest: digest, mode: record.authorization.mode, approvalPolicy: record.authorization.approvalPolicy, outcome: record.authorization.outcome });
  add('authorization.history', 'cannot-verify', 'Durable authorization is recorded as allowed-once under ask policy. Native approval transcript, provider charges and billed usage are not available; no cost estimate is fabricated.', ['status.authorization'], { approvedAt: record.authorization.approvedAt, transcriptAvailable: false, chargesAvailable: false });
  const expectedSources = ['reviewers', 'concurrency', 'timeoutMs', 'judge', 'judge.kind', ...record.config.reviewers.flatMap((r, i) => Object.keys(r).map(key => `reviewers.${i}.${key}`)), ...Object.keys(record.config.judge).filter(key => key !== 'kind').map(key => `judge.${key}`)];
  const missingSources = expectedSources.filter(key => !record.sources[key]?.trim());
  add('config.provenance', missingSources.length ? 'insufficient-evidence' : 'pass', 'Effective frozen configuration and exact routes are present; absent configuration-layer sources are missing evidence, not proof of substitution.', ['status.config', 'status.sources'], { configuration: record.config, sources: record.sources, missingSources });
  const continuousClock = record.updatedAt >= record.createdAt && record.deadline >= record.createdAt && record.authorization.approvedAt <= record.createdAt && record.audit.every((event, i) => event.at >= record.createdAt && event.at <= record.updatedAt && (!i || event.at >= record.audit[i - 1]!.at));
  add('revision.timeline', continuousClock ? 'pass' : 'insufficient-evidence',
    'These are Date.now wall-clock observations, not a monotonic clock or one-to-one revision receipts. Clock rollback or a restored future-dated record can explain discontinuity; timestamps alone do not establish a contract violation.', ['status.revision', 'status.createdAt', 'status.updatedAt', 'status.deadline', 'status.audit', 'status.authorization.approvedAt', 'CrossReviewService.update'], { revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt, deadline: record.deadline, approvedAt: record.authorization.approvedAt, continuousClock, monotonicClockGuaranteed: false, timeline: record.audit.map(({ at, action }) => ({ at, action })) });
  add('revision.history', 'cannot-verify', 'Only the current immutable record is observed. Its event log is not a sequence of historical record revisions; past transition contents cannot be reconstructed.', ['CrossReviewService.status', 'status.revision', 'status.audit'], { revision: record.revision, historicalSnapshotsAvailable: false });
  test('cancellation', record.cancellationIntent === (record.state === 'cancelled'), 'Cancellation intent and cancelled state must agree; in-flight abort drainage is not inferred from absent registry observations.', ['status.state', 'status.cancellationIntent'], { state: record.state, cancellationIntent: record.cancellationIntent });
  const recovered = record.audit.some(event => event.action === 'recovered');
  test('recovery', !recovered || !record.attempts.some(a => ['pending', 'provisioning', 'running'].includes(a.state)), 'Recovery preserves confirmed results and interrupts unresolved work; it does not admit automatic paid replay.', ['status.audit', 'status.attempts', 'CrossReviewService.recover'], { recovered, attempts });
  add('pending.state', ['awaiting_timeout', 'interrupted'].includes(record.state) ? 'insufficient-evidence' : 'pass', 'Timeout/recovery requires an explicit owner preserve/abort decision. A pending or interrupted run is not a terminal completed report; unknown work is not replayed.', ['status.state', 'status.attempts', 'status.failure'], { state: record.state, failure: record.failure ?? null, unresolved: attempts.filter(a => ['pending', 'provisioning', 'running', 'interrupted'].includes(a.state)) });
  test('completion.quorum', !['completed', 'awaiting_judge'].includes(record.state) || completed.length >= required, 'Strict majority of confirmed schema-valid reviewer results is a completion threshold, never a correctness vote.', ['status.config.reviewers', 'status.attempts', 'status.state'], { reviewerCompleted: completed.length, reviewerRequired: required, state: record.state });
  test('completion.settled', record.state !== 'completed' || !record.attempts.some(a => ['pending', 'provisioning', 'running'].includes(a.state)), 'Completed runs cannot still have unresolved paid attempts; native release after confirmed completion is a separate lifecycle step.', ['status.state', 'status.attempts'], { state: record.state, attempts });
  const reportObservation = input.report ? structuredClone(input.report) : undefined;
  const sameReportIdentity = reportObservation?.runId === record.id && reportObservation.snapshotId === record.snapshot.id;
  if (reportObservation) test('report.identity', sameReportIdentity, 'Run ID and snapshot ID are immutable across revisions. Every report observation must match the owner-validated status/request binding, even when revisions differ.', ['CrossReviewService.status', 'CrossReviewService.report', 'ReviewStore.update'], { expected: { runId: record.id, snapshotId: record.snapshot.id }, observed: { runId: reportObservation.runId, snapshotId: reportObservation.snapshotId }, statusRevision: record.revision, reportRevision: reportObservation.revision });
  try {
    const derived = consolidateResults(completed.map(a => a.result!), record.snapshot, record.decisions);
    test('judgment', record.config.judge.kind === 'parent' || isDeepStrictEqual(record.decisions, judges.filter(a => a.state === 'completed').flatMap(a => a.decisions ?? [])), 'Canonical decisions refer only to confirmed candidates and are unique; model-judge decisions must exactly mirror confirmed judge results. Evidence quotations are checked, not finding quality.', ['status.decisions', 'status.attempts', 'consolidateResults'], { decisions: record.decisions, judgeDecisions: judges.map(a => ({ attemptId: a.id, state: a.state, decisions: a.decisions ?? null })), findings: derived.findings.map(f => f.id), pending: derived.pending.map(f => f.id), rejected: derived.rejected });
    test('completion.pending', record.state !== 'completed' || !derived.pending.length, 'Completed reports cannot retain pending independent judgments.', ['status.state', 'consolidateResults.pending'], { state: record.state, pendingIds: derived.pending.map(f => f.id) });
    if (reportObservation) {
      const report = reportObservation;
      if (!sameReportIdentity) {
        add('report.consistency', 'cannot-verify', 'Report immutable identity mismatch is a verified report.identity anomaly; state/results cannot be compared as observations of the same run evidence.', ['CrossReviewService.status', 'CrossReviewService.report'], { status: binding, report: { runId: report.runId, revision: report.revision, snapshotId: report.snapshotId } });
      } else if (report.revision !== record.revision) {
        add('report.consistency', 'insufficient-evidence', 'status and report read current records independently. Different revisions cannot be compared as one snapshot; no polling or retry is initiated.', ['CrossReviewService.status', 'CrossReviewService.report'], { status: binding, report: { runId: report.runId, revision: report.revision, snapshotId: report.snapshotId } });
      } else {
        const expected: ReviewReport = { runId: record.id, revision: record.revision, state: record.state, complete: record.state === 'completed' && !derived.pending.length, snapshotId: record.snapshot.id, ...derived, reviewerCompleted: completed.length, reviewerRequired: required, audit: record.audit };
        test('report.consistency', isDeepStrictEqual(report, expected), 'At the same revision, report binding, terminal flag, threshold, decisions, rejected/pending findings and audit must match the confirmed-record derivation.', ['CrossReviewService.report', 'status', 'consolidateResults'], { expected, observed: report });
      }
    } else add('report.read', 'cannot-verify', 'No derived report observation is available; record checks do not prove report consistency.', ['CrossReviewService.report'], { error: input.reportError ?? 'Report not supplied' });
  } catch (error) {
    add('judgment', 'anomaly', 'Confirmed candidate/decision derivation rejects this supplied observation.', ['status.decisions', 'status.attempts', 'consolidateResults'], { error: error instanceof Error ? error.message : 'Judgment derivation failed' });
  }
  return finish();
}

/** Status failures (including owner rejection and validated-store read failure)
 * propagate, never become fabricated run evidence. Report failure after status
 * remains explicitly unverifiable, e.g. cleanup between the two reads. */
export async function auditRun(service: ReviewObservation, agent: Agent, runId: string, signal: AbortSignal): Promise<AuditResult> {
  signal.throwIfAborted();
  z.string().uuid().parse(runId);
  const record = await service.status(agent, runId);
  if (record.id !== runId) throw new Error('Cross-review status returned a different run identity');
  signal.throwIfAborted();
  let report: ReviewReport | undefined; let reportError: string | undefined;
  try { report = await service.report(agent, runId); }
  catch (error) { reportError = error instanceof Error ? error.message : 'Report read failed'; }
  signal.throwIfAborted();
  return inspectAuditSnapshot({ record, report, reportError });
}
