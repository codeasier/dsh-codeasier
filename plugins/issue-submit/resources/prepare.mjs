// Pure issue-submit data preparation, not a forge client or execution engine.
// Adapted workflow: open-codeasier@20194ff7a7b26fd51965e50bdb5091cb37a4c0f5
// Copyright (c) 2026 codeasier. MIT; see LICENSE.upstream.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const directory = '.github/ISSUE_TEMPLATE';
const legacy = '.github/ISSUE_TEMPLATE.md';
const configPath = `${directory}/config.yml`;
const confirmLabel = 'Submit this exact preview';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireThat(value, message) { if (!value) throw new Error(message); }
function text(value, name, empty = false) {
  requireThat(typeof value === 'string' && !value.includes('\0') && (empty || value.trim()), `Invalid ${name}`);
  return value;
}
export function target(value) {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value), 'Require one explicit GitHub owner/repo');
  return value;
}
function yaml(source) {
  const doc = parseDocument(source, { uniqueKeys: true });
  requireThat(!doc.errors.length && !doc.warnings.length, 'Malformed or unsupported YAML');
  return doc.toJS({ maxAliasCount: 50 });
}
function names(value, name) {
  const result = value === undefined || value === '' ? [] : typeof value === 'string' ? value.split(',').map(s => s.trim()) : value;
  requireThat(Array.isArray(result), `Invalid ${name}`);
  result.forEach(item => { text(item, name); requireThat(!/[\r\n]/.test(item), `Invalid ${name}`); });
  requireThat(new Set(result).size === result.length, `Duplicate ${name}`);
  return result;
}
function readOutcome(files, path, kind = 'file') {
  const response = files[path];
  requireThat(record(response), `Missing read outcome: ${path}`);
  if (response.status === 404) return null;
  requireThat(response.status === 200 && response.kind === kind, `Read failed or wrong type: ${path}`);
  if (kind === 'file') text(response.content, path, true);
  else requireThat(Array.isArray(response.entries), `Malformed directory: ${path}`);
  return response;
}
function metadata(source, path, description) {
  requireThat(record(source) && Object.keys(source).every(key => ['name', description, 'title', 'labels', 'assignees', ...(description === 'description' ? ['body'] : [])].includes(key)), `Invalid or unsupported template metadata: ${path}`);
  return { name: text(source.name, 'template name'), description: text(source[description], 'template description'),
    title: source.title === undefined ? '' : text(source.title, 'default title', true),
    labels: names(source.labels, 'labels'), assignees: names(source.assignees, 'assignees') };
}
function form(source, path) {
  const meta = metadata(source, path, 'description');
  requireThat(Array.isArray(source.body) && source.body.length, `Missing form body: ${path}`);
  const ids = new Set();
  for (const field of source.body) {
    requireThat(record(field) && ['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'].includes(field.type), 'Unsupported form field');
    requireThat(record(field.attributes), 'Missing field attributes');
    const supported = { markdown: ['value'], input: ['label', 'description', 'placeholder', 'value'], textarea: ['label', 'description', 'placeholder', 'value', 'render'], dropdown: ['label', 'description', 'options', 'default', 'multiple'], checkboxes: ['label', 'description', 'options'] };
    requireThat(Object.keys(field).every(key => ['type', 'id', 'attributes', 'validations'].includes(key)) && Object.keys(field.attributes).every(key => supported[field.type].includes(key)), 'Unsupported form attributes');
    if (field.type === 'markdown') { text(field.attributes.value, 'markdown guidance'); continue; }
    text(field.id, 'field id'); requireThat(/^[a-zA-Z0-9_-]+$/.test(field.id) && !['__proto__', 'constructor', 'prototype'].includes(field.id), 'Unsafe field id'); requireThat(!ids.has(field.id), 'Duplicate field id'); ids.add(field.id);
    text(field.attributes.label, 'field label');
    requireThat(field.validations === undefined || (record(field.validations) && Object.keys(field.validations).every(key => key === 'required')
      && (field.validations.required === undefined || typeof field.validations.required === 'boolean')), 'Unsupported field validations');
    if (['input', 'textarea'].includes(field.type)) {
      if (field.attributes.value !== undefined) text(field.attributes.value, 'field default', true);
      if (field.attributes.render !== undefined) requireThat(field.type === 'textarea' && /^[a-zA-Z0-9_+-]*$/.test(field.attributes.render), 'Unsupported render language');
    } else {
      requireThat(Array.isArray(field.attributes.options) && field.attributes.options.length, 'Missing field options');
      const options = field.attributes.options.map(option => field.type === 'dropdown' ? text(option, 'dropdown option')
        : (requireThat(record(option) && (option.required === undefined || typeof option.required === 'boolean'), 'Invalid checkbox option'), text(option.label, 'checkbox label')));
      requireThat(new Set(options).size === options.length, 'Duplicate options');
      if (field.type === 'dropdown') {
        requireThat(field.attributes.multiple === undefined || typeof field.attributes.multiple === 'boolean', 'Invalid multiple');
        if (field.attributes.default !== undefined) requireThat(Number.isInteger(field.attributes.default) && field.attributes.default >= 0
          && field.attributes.default < options.length, 'Invalid dropdown default');
      }
    }
  }
  return { ...meta, id: path, kind: 'form', fields: source.body };
}
function markdown(content, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  requireThat(match, `Markdown template needs frontmatter: ${path}`);
  return { ...metadata(yaml(match[1]), path, 'about'), id: path, kind: 'markdown', body: content.slice(match[0].length) };
}

/** Input includes actual HTTP outcomes; only authenticated path-level 404 means absence. */
export function discover({ repo, authenticated, repository, files }) {
  target(repo); requireThat(authenticated === true, 'Authentication unavailable: stop without writes');
  requireThat(record(repository) && repository.full_name === repo && repository.has_issues === true && typeof repository.default_branch === 'string', 'Target mismatch or issues disabled');
  requireThat(record(files), 'Missing discovery reads');
  const listing = readOutcome(files, directory, 'directory');
  const old = readOutcome(files, legacy);
  const config = readOutcome(files, configPath);
  const settings = config ? yaml(config.content) : {};
  requireThat(record(settings) && (settings.blank_issues_enabled === undefined || typeof settings.blank_issues_enabled === 'boolean'), 'Invalid issue config');
  const links = settings.contact_links ?? [];
  requireThat(Array.isArray(links), 'Invalid contact links');
  const contacts = links.map(link => {
    requireThat(record(link), 'Invalid contact link');
    const url = new URL(text(link.url, 'contact URL')); requireThat(['https:', 'http:'].includes(url.protocol), 'Unsafe contact URL');
    return { name: text(link.name, 'contact name'), about: text(link.about, 'contact about'), url: url.href };
  });
  const choices = [];
  const paths = new Set();
  for (const entry of listing?.entries ?? []) {
    requireThat(record(entry) && typeof entry.path === 'string' && entry.path.startsWith(`${directory}/`) && !entry.path.slice(directory.length + 1).includes('/'), 'Unsafe listed path');
    const filename = entry.path.slice(directory.length + 1);
    requireThat(filename !== '.' && filename !== '..' && !filename.includes('\\') && !paths.has(entry.path), 'Unsafe or duplicate listed path'); paths.add(entry.path);
    if (filename.startsWith('.') || entry.path === configPath || !/\.(?:md|ya?ml)$/.test(filename)) continue;
    requireThat(entry.type === 'file', 'Template must be a regular file, not a symlink/directory');
    const response = readOutcome(files, entry.path); requireThat(response, 'Listed template disappeared');
    choices.push(filename.endsWith('.md') ? markdown(response.content, entry.path) : form(yaml(response.content), entry.path));
  }
  if (!choices.length && old) choices.push({ id: legacy, kind: 'legacy', name: 'Legacy template', description: 'Repository legacy body', title: '', body: old.content, labels: [], assignees: [] });
  if (settings.blank_issues_enabled !== false) choices.push({ id: 'blank', kind: 'blank', name: 'Blank issue', description: 'No template', title: '', labels: [], assignees: [] });
  return { repo, choices, contacts, legacyPresent: Boolean(old), blankEnabled: settings.blank_issues_enabled !== false };
}
function fence(value, language) {
  const longest = Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length));
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter}${language}\n${value}\n${delimiter}`;
}
export function render({ catalog, selection, title, answers = {}, body, labels, assignees }) {
  requireThat(record(catalog) && Array.isArray(catalog.choices), 'Invalid catalog'); target(catalog.repo);
  const chosen = catalog.choices.find(choice => choice.id === selection); requireThat(chosen, 'Choose a discovered template or permitted blank');
  requireThat(record(answers), 'Invalid answers');
  let rendered = body;
  if (chosen.kind === 'form') {
    const fields = chosen.fields.filter(field => field.type !== 'markdown');
    requireThat(Object.keys(answers).every(id => fields.some(field => field.id === id)), 'Unknown answer ID');
    const sections = fields.map(field => {
      const attr = field.attributes; let answer = Object.hasOwn(answers, field.id) ? answers[field.id] : undefined; const required = field.validations?.required === true;
      if (['input', 'textarea'].includes(field.type)) {
        if (answer === undefined) answer = attr.value ?? '';
        text(answer, field.id, !required);
        if (field.type === 'input') requireThat(!/[\r\n]/.test(answer), 'Input must be single-line');
        answer = answer.trim() ? (field.type === 'textarea' && attr.render !== undefined ? fence(answer, attr.render) : answer) : '_No response_';
      } else if (field.type === 'dropdown') {
        if (answer === undefined) answer = attr.default === undefined ? [] : [attr.options[attr.default]];
        if (typeof answer === 'string') answer = [answer];
        requireThat(Array.isArray(answer) && (!required || answer.length) && (attr.multiple === true || answer.length <= 1)
          && new Set(answer).size === answer.length && answer.every(value => attr.options.includes(value)), `Invalid required dropdown: ${field.id}`);
        answer = answer.length ? answer.join(', ') : '_No response_';
      } else {
        if (answer === undefined) answer = [];
        requireThat(Array.isArray(answer) && (!required || answer.length) && new Set(answer).size === answer.length
          && answer.every(value => attr.options.some(option => option.label === value))
          && attr.options.every(option => !option.required || answer.includes(option.label)), `Required checkbox missing: ${field.id}`);
        answer = attr.options.map(option => `- [${answer.includes(option.label) ? 'X' : ' '}] ${option.label}`).join('\n');
      }
      return `### ${attr.label}\n\n${answer}`;
    });
    requireThat(body === undefined, 'Form body must be rendered from fields'); rendered = sections.join('\n\n');
  } else {
    requireThat(!Object.keys(answers).length, 'Use a completed body for Markdown/legacy/blank issues');
    text(rendered, 'completed body');
  }
  const draft = { repo: catalog.repo, selection, title: title ?? chosen.title, body: rendered,
    labels: labels === undefined ? [...chosen.labels] : names(labels, 'labels'),
    assignees: assignees === undefined ? [...chosen.assignees] : names(assignees, 'assignees') };
  return validated(draft);
}
function validated(draft) {
  requireThat(record(draft), 'Invalid draft'); target(draft.repo); text(draft.selection, 'selected source');
  text(draft.title, 'title'); requireThat(!/[\r\n]/.test(draft.title), 'Title must be single-line'); text(draft.body, 'body');
  requireThat(Array.isArray(draft.labels) && Array.isArray(draft.assignees), 'Missing draft metadata');
  names(draft.labels, 'labels'); names(draft.assignees, 'assignees');
  return { repo: draft.repo, selection: draft.selection, title: draft.title, body: draft.body, labels: draft.labels, assignees: draft.assignees };
}
export function preview(input) {
  const draft = validated(input);
  const digest = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  return { draft, question: { id: `submit-${digest}`, question: `Repository: ${draft.repo}\nSource: ${draft.selection}\nTitle: ${draft.title}\nLabels: ${JSON.stringify(draft.labels)}\nAssignees: ${JSON.stringify(draft.assignees)}\n\n${draft.body}\n\nSubmit exactly this issue once?`, options: [{ label: confirmLabel }, { label: 'Cancel' }] } };
}
// Cobra StringSlice flags parse CSV even when repeated: retain commas/quotes in names.
const csv = value => /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
export function submissionArguments(draft, answer) {
  const shown = preview(draft);
  requireThat(record(answer) && Array.isArray(answer.answers) && answer.answers.length === 1, 'No explicit confirmation');
  const item = answer.answers[0];
  requireThat(item.id === shown.question.id && Array.isArray(item.selected) && item.selected.length === 1 && item.selected[0] === confirmLabel && item.custom === undefined, 'Cancelled, pending, changed or unconfirmed preview');
  const value = shown.draft;
  return ['issue', 'create', '--repo', value.repo, '--title', value.title, '--body', value.body,
    ...value.labels.flatMap(label => ['--label', csv(label)]), ...value.assignees.flatMap(assignee => ['--assignee', csv(assignee)])];
}
export function reconcile(draft, { records, complete, author, since }) {
  validated(draft); text(author, 'author'); requireThat(Number.isFinite(Date.parse(since)), 'Invalid attempt timestamp');
  requireThat(Array.isArray(records), 'Invalid readback');
  if (complete !== true) return { status: 'unresolved', retry: false };
  const sameNames = (a, b) => Array.isArray(a) && a.length === b.length && b.every(name => a.some(value => (typeof value === 'string' ? value : value.name ?? value.login) === name));
  const matches = records.filter(value => !value.pull_request && value.user?.login === author && Date.parse(value.created_at) >= Date.parse(since)
    && value.title === draft.title && value.body === draft.body && sameNames(value.labels, draft.labels) && sameNames(value.assignees, draft.assignees)
    && typeof value.html_url === 'string' && value.html_url.startsWith(`https://github.com/${draft.repo}/issues/`) && /\/issues\/[1-9]\d*$/.test(value.html_url));
  return matches.length === 1 ? { status: 'verified', url: matches[0].html_url, retry: false } : { status: matches.length > 1 ? 'ambiguous' : 'unresolved', retry: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const { action, ...args } = JSON.parse(input);
    const result = action === 'discover' ? discover(args) : action === 'render' ? render(args) : action === 'preview' ? preview(args.draft)
      : action === 'arguments' ? submissionArguments(args.draft, args.answer) : action === 'reconcile' ? reconcile(args.draft, args.readback) : (() => { throw new Error('Unknown data action'); })();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
