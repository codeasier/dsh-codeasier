// Pure issue-review comment preparation; no forge client or write executor.
// Adapted workflow: open-codeasier@20194ff7a7b26fd51965e50bdb5091cb37a4c0f5
// Copyright (c) 2026 codeasier. MIT; see LICENSE.upstream.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const label = 'Post this exact comment';
function requireThat(value, message) { if (!value) throw new Error(message); }
function text(value, name) { requireThat(typeof value === 'string' && value.trim() && !value.includes('\0'), `Invalid ${name}`); return value; }
function validate(draft) {
  requireThat(draft && /^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(draft.repo), 'Require one GitHub owner/repo');
  requireThat(Number.isSafeInteger(draft.number) && draft.number > 0, 'Require exactly one issue number');
  text(draft.body, 'comment body');
  return { repo: draft.repo, number: draft.number, body: draft.body };
}
export function render({ repo, number, reality, reasonableness, boundary, evidence, limitations }) {
  requireThat(Array.isArray(evidence) && evidence.length > 0, 'Evidence references required');
  evidence.forEach(value => text(value, 'evidence'));
  const body = `## Issue review\n\n**Reality:** ${text(reality, 'reality')}\n\n**Reasonableness:** ${text(reasonableness, 'reasonableness')}\n\n**Boundary:** ${text(boundary, 'boundary')}\n\n**Evidence:**\n${evidence.map(value => `- ${value}`).join('\n')}\n\n**Limitations:** ${text(limitations, 'limitations')}`;
  return validate({ repo, number, body });
}
export function preview(input) {
  const draft = validate(input); const digest = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  return { draft, question: { id: `review-${digest}`, question: `Repository: ${draft.repo}\nIssue: #${draft.number}\n\n${draft.body}\n\nPost exactly this comment once?`, options: [{ label }, { label: 'Cancel' }] } };
}
export function commentArguments(draft, answer) {
  const shown = preview(draft);
  requireThat(answer && Array.isArray(answer.answers) && answer.answers.length === 1, 'No explicit confirmation');
  const item = answer.answers[0];
  requireThat(item.id === shown.question.id && Array.isArray(item.selected) && item.selected.length === 1 && item.selected[0] === label && item.custom === undefined, 'Cancelled, pending, changed or unconfirmed preview');
  return ['issue', 'comment', String(shown.draft.number), '--repo', shown.draft.repo, '--body', shown.draft.body];
}
export function reconcile(draft, { records, complete, author, since }) {
  validate(draft); text(author, 'author'); requireThat(Number.isFinite(Date.parse(since)), 'Invalid attempt timestamp');
  requireThat(Array.isArray(records), 'Invalid readback');
  if (complete !== true) return { status: 'unresolved', retry: false };
  const matches = records.filter(value => value.user?.login === author && Date.parse(value.created_at) >= Date.parse(since) && value.body === draft.body
    && typeof value.html_url === 'string' && value.html_url.startsWith(`https://github.com/${draft.repo}/issues/${draft.number}#issuecomment-`) && /#issuecomment-\d+$/.test(value.html_url));
  return matches.length === 1 ? { status: 'verified', url: matches[0].html_url, retry: false } : { status: matches.length > 1 ? 'ambiguous' : 'unresolved', retry: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const { action, ...args } = JSON.parse(input);
    const result = action === 'render' ? render(args) : action === 'preview' ? preview(args.draft) : action === 'arguments' ? commentArguments(args.draft, args.answer)
      : action === 'reconcile' ? reconcile(args.draft, args.readback) : (() => { throw new Error('Unknown data action'); })();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
