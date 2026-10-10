import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type EvidenceTarget =
  | { kind: 'local'; root: string }
  | { kind: 'range'; root: string; base: string; head: string }
  | { kind: 'github' | 'gitcode'; root: string; url: string };

export interface Snapshot {
  readonly id: string;
  readonly version: 1;
  readonly target: EvidenceTarget;
  readonly diff: string;
  readonly files: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly createdAt: number;
  /** Resolved immutable commits; local files/diff additionally belong to the content hash. */
  readonly provenance?: Readonly<{ base: string; head: string; mergeBase?: string }>;
}

const FILE_BYTES = 8 * 1024 * 1024;
const TOTAL_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
const restricted = /^(?:\.git|\.hg|\.svn|\.dsh|\.worktrees|node_modules|\.cross-review|\.dsh-codeasier|artifacts|outputs?|reports?|credentials?|secrets?|\.npmrc|\.netrc|\.aws|\.ssh|\.env(?:\..*)?)$/i;
const credential = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9/+_-]{16,}/i;

function fail(message: string): never { throw new Error(`Evidence: ${message}`); }
function text(value: string, label: string, max = FILE_BYTES): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || value.includes('\0')) fail(`invalid or oversized ${label}`);
  // UTF-16 lone surrogates are not immutable UTF-8 evidence bytes.
  if (Buffer.from(value).toString('utf8') !== value) fail(`invalid UTF-8 ${label}`);
  if (credential.test(value)) fail(`credential-like material in ${label}`);
  return value;
}
function pathKey(path: string): string {
  if (typeof path !== 'string' || !path || path.length > 4096 || isAbsolute(path) || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) fail('unsafe evidence path');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p === '__proto__' || p === 'constructor' || p === 'prototype' || restricted.test(p)) || /\.(?:pem|key|p12|pfx)$/i.test(path)) fail('restricted evidence path');
  return path;
}
function dataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected plain record');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('expected plain record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !d.enumerable || !('value' in d))) fail('record must contain only enumerable data');
  return value as Record<string, unknown>;
}
function keys(record: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(record).some(k => !allowed.includes(k))) fail('unexpected record field');
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) fail('invalid immutable commit');
  return value;
}
function prUrl(kind: 'github' | 'gitcode', value: unknown): { url: string; owner: string; repo: string; number: string } {
  if (typeof value !== 'string') fail('invalid PR URL');
  let url: URL;
  try { url = new URL(value); } catch { return fail('invalid PR URL'); }
  const host = kind === 'github' ? 'github.com' : 'gitcode.com';
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash) fail('invalid PR URL authority');
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|pulls|merge_requests)\/([1-9][0-9]*)\/?$/.exec(url.pathname);
  if (!match || !Number.isSafeInteger(Number(match[4])) || (kind === 'github' && match[3] !== 'pull') || (kind === 'gitcode' && match[3] === 'pull')) fail('invalid PR URL shape');
  const owner = pathKey(match[1]!); const repo = pathKey(match[2]!);
  return { url: `https://${host}/${owner}/${repo}/${kind === 'github' ? 'pull' : 'merge_requests'}/${match[4]}`, owner, repo, number: match[4]! };
}
function targetData(value: unknown): EvidenceTarget {
  const r = dataObject(value);
  if (typeof r.root !== 'string' || !isAbsolute(r.root) || resolve(r.root) !== r.root || r.root.includes('\0')) fail('target requires canonical absolute root');
  if (r.kind === 'local') { keys(r, ['kind', 'root']); return { kind: 'local', root: r.root }; }
  if (r.kind === 'range') { keys(r, ['kind', 'root', 'base', 'head']); return { kind: 'range', root: r.root, base: sha(r.base), head: sha(r.head) }; }
  if (r.kind === 'github' || r.kind === 'gitcode') { keys(r, ['kind', 'root', 'url']); return { kind: r.kind, root: r.root, url: prUrl(r.kind, r.url).url }; }
  return fail('unknown target kind');
}
function canonical(snapshot: Omit<Snapshot, 'id'>): string {
  return JSON.stringify({ version: snapshot.version, target: snapshot.target, diff: snapshot.diff,
    files: Object.fromEntries(Object.entries(snapshot.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    notes: snapshot.notes, createdAt: snapshot.createdAt, provenance: snapshot.provenance ?? null });
}
function digest(snapshot: Omit<Snapshot, 'id'>): string { return `sha256:${createHash('sha256').update(canonical(snapshot)).digest('hex')}`; }

/** Verify durable evidence and return a detached, deeply immutable snapshot. */
export function validateSnapshot(value: unknown): Snapshot {
  const r = dataObject(value);
  keys(r, ['id', 'version', 'target', 'diff', 'files', 'notes', 'createdAt', 'provenance']);
  if (r.version !== 1 || typeof r.id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.id) || !Number.isSafeInteger(r.createdAt) || (r.createdAt as number) < 0) fail('invalid snapshot identity/version/time');
  const target = Object.freeze(targetData(r.target));
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let bytes = 0;
  for (const [path, content] of Object.entries(dataObject(r.files))) {
    if (typeof content !== 'string') fail('non-text evidence');
    files[pathKey(path)] = text(content, 'file'); bytes += Buffer.byteLength(content);
  }
  if (bytes > TOTAL_BYTES) fail('evidence exceeds byte budget');
  if (!Array.isArray(r.notes) || r.notes.length > 100 || r.notes.some(n => typeof n !== 'string')) fail('invalid notes');
  const notes = Object.freeze(r.notes.map(n => text(n as string, 'note', 256 * 1024)));
  let provenance: Snapshot['provenance'];
  if (r.provenance !== undefined) {
    const p = dataObject(r.provenance); keys(p, ['base', 'head', 'mergeBase']);
    if (p.mergeBase !== undefined && target.kind !== 'github' && target.kind !== 'gitcode') fail('merge-base is only valid for PR evidence');
    provenance = Object.freeze({ base: sha(p.base), head: sha(p.head), ...(p.mergeBase !== undefined ? { mergeBase: sha(p.mergeBase) } : {}) });
  }
  if (target.kind !== 'local' && !provenance) fail('immutable commit provenance required');
  if (target.kind === 'range' && (provenance!.base !== target.base || provenance!.head !== target.head)) fail('range provenance mismatch');
  const body: Omit<Snapshot, 'id'> = { version: 1, target, diff: text(r.diff as string, 'diff', TOTAL_BYTES), files: Object.freeze(files), notes, createdAt: r.createdAt as number,
    ...(provenance ? { provenance } : {}) };
  if (digest(body) !== r.id) fail('snapshot content hash mismatch');
  return Object.freeze({ id: r.id, ...body });
}

/** These accessors never consult the mutable workspace, Git, or a network. */
export function listEvidence(snapshot: Snapshot): string[] {
  return Object.keys(validateSnapshot(snapshot).files).sort();
}
export function readEvidence(snapshot: Snapshot, path: string, offset = 1, limit = 200): { path: string; lines: { number: number; text: string }[]; totalLines: number } {
  pathKey(path);
  const safe = validateSnapshot(snapshot);
  if (!Object.hasOwn(safe.files, path)) fail('path is outside snapshot');
  if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) fail('invalid evidence line range');
  const content = safe.files[path]!;
  const lines = content === '' ? [] : content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return { path, lines: lines.slice(offset - 1, offset - 1 + limit).map((text, i) => ({ number: offset + i, text })), totalLines: lines.length };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}
async function git(root: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.extraHeader=', '-c', 'core.askPass=',
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...args],
    { cwd: root, env: gitEnvironment(), encoding: 'buffer', maxBuffer: TOTAL_BYTES, timeout: 60_000 }, (error, stdout) => {
      // Never expose stderr, arguments, remote URL credentials, or environment values.
      if (error) reject(new Error(`Evidence: Git ${args[0] ?? 'operation'} failed`)); else resolvePromise(stdout);
    });
  });
}
function decode(buffer: Buffer): string {
  if (buffer.includes(0)) fail('binary evidence is unsupported');
  let value: string;
  try { value = decoder.decode(buffer); } catch { return fail('non-UTF-8 evidence is unsupported'); }
  return text(value, 'file');
}
function paths(buffer: Buffer): string[] { return buffer.toString('utf8').split('\0').filter(Boolean); }
async function rootPath(input: string): Promise<string> {
  if (typeof input !== 'string' || !isAbsolute(input)) fail('root must be absolute');
  const root = await realpath(input);
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  if (await realpath(top) !== root) fail('root must be repository top-level');
  // Built-in Git diff/status may execute clean/process filters even with --no-ext-diff.
  // Reject command-bearing filters rather than executing repository configuration.
  for (const entry of paths(await git(root, ['config', '--list', '--null', '--includes']))) {
    const split = entry.indexOf('\n');
    const key = entry.slice(0, split < 0 ? entry.length : split).toLowerCase();
    const value = split < 0 ? '' : entry.slice(split + 1);
    if (value && (/^filter\..*\.(?:clean|smudge|process)$/.test(key) || key === 'core.alternaterefscommand')) fail('repository command filters are unsupported');
    if (value && (/^url\..*\.(?:insteadof|pushinsteadof)$/.test(key) || /^http\..*\.(?:extraheader|cookiefile|proxy)$/.test(key) || key === 'http.cookiefile')) fail('repository remote rewrites or credential transport settings are unsupported');
  }
  return root;
}
async function revision(root: string, ref: string): Promise<string> {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\x00-\x20\x7f]/.test(ref)) fail('unsafe revision');
  return sha((await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).toString('utf8').trim());
}
async function changedPaths(root: string, base: string, head?: string): Promise<string[]> {
  return paths(await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, ...(head ? [head] : []), '--']));
}
function assertChanges(paths: readonly string[]): void { for (const path of paths) pathKey(path); }
async function diff(root: string, base: string, head?: string): Promise<string> {
  const patch = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', base, ...(head ? [head] : []), '--'])).toString('utf8');
  if (/^GIT binary patch$|^Binary files .* differ$/m.test(patch)) fail('binary changes are unsupported');
  if (/^(?:new file mode|deleted file mode|old mode|new mode) (?:120000|160000)$/m.test(patch)) fail('symlink or submodule changes are unsupported');
  return text(patch, 'diff', TOTAL_BYTES);
}

async function workingFile(root: string, path: string): Promise<{ content: string; executable: boolean } | undefined> {
  pathKey(path);
  const absolute = join(root, ...path.split('/'));
  let prefix = root;
  for (const part of path.split('/').slice(0, -1)) {
    prefix = join(prefix, part);
    const stat = await lstat(prefix);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe evidence ancestor');
  }
  let before;
  try { before = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (before.isSymbolicLink() || !before.isFile()) fail('symlink or special file evidence is unsupported');
  if (before.size > FILE_BYTES) fail('file exceeds byte budget');
  const resolved = await realpath(absolute);
  const relativePath = relative(root, resolved);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath) || resolved !== absolute) fail('evidence escapes root');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile()) fail('workspace changed during capture');
    const buffer = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(absolute);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink() || await realpath(absolute) !== absolute) fail('workspace changed during capture');
    return { content: decode(buffer), executable: (before.mode & 0o111) !== 0 };
  } finally { await handle.close(); }
}
function addedDiff(path: string, content: string, executable: boolean): string {
  const a = JSON.stringify(`a/${path}`); const b = JSON.stringify(`b/${path}`);
  let out = `diff --git ${a} ${b}\nnew file mode ${executable ? '100755' : '100644'}\n--- /dev/null\n+++ ${b}\n`;
  if (content === '') return out;
  const lines = content.split('\n'); const newline = content.endsWith('\n');
  if (newline) lines.pop();
  out += `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join('')}`;
  if (!newline) out += '\\ No newline at end of file\n';
  return out;
}
async function localCapture(root: string): Promise<{ head: string; state: string; diff: string; files: Record<string, string> }> {
  const head = await revision(root, 'HEAD');
  const untracked = paths(await git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  const changed = await changedPaths(root, head);
  assertChanges([...changed, ...untracked]);
  if ((await git(root, ['ls-files', '--unmerged', '-z'])).length) fail('unmerged index is unsupported');
  const state = `${head}\n${(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).toString('base64')}\n${(await git(root, ['ls-files', '--stage', '-z'])).toString('base64')}`;
  const tracked = paths(await git(root, ['ls-files', '--cached', '-z']));
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let patch = await diff(root, head);
  let bytes = 0;
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    try { pathKey(path); } catch { continue; } // unchanged excluded paths are never exposed; changes already rejected above.
    const file = await workingFile(root, path);
    if (file) {
      files[path] = file.content;
      bytes += Buffer.byteLength(file.content);
      if (bytes > TOTAL_BYTES) fail('evidence exceeds byte budget');
      if (untracked.includes(path)) patch += addedDiff(path, file.content, file.executable);
      if (Buffer.byteLength(patch) > TOTAL_BYTES) fail('diff exceeds byte budget');
    } else if (untracked.includes(path) || !changed.includes(path)) fail('workspace changed or tracked evidence unavailable during capture');
  }
  return { head, state, diff: patch, files };
}
async function rangeCapture(root: string, base: string, head: string): Promise<{ diff: string; files: Record<string, string> }> {
  assertChanges(await changedPaths(root, base, head));
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let bytes = 0;
  for (const entry of paths(await git(root, ['ls-tree', '-r', '-z', head]))) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) fail('invalid Git tree entry');
    const path = match[4]!;
    try { pathKey(path); } catch { continue; }
    if (match[2] !== 'blob' || !['100644', '100755'].includes(match[1]!)) fail('symlink or submodule evidence is unsupported');
    files[path] = decode(await git(root, ['cat-file', 'blob', match[3]!]));
    bytes += Buffer.byteLength(files[path]!);
    if (bytes > TOTAL_BYTES) fail('evidence exceeds byte budget');
  }
  return { diff: await diff(root, base, head), files };
}

function repositoryUrl(kind: 'github' | 'gitcode', value: unknown): string {
  if (typeof value !== 'string') fail('PR repository URL unavailable');
  let url: URL; try { url = new URL(value); } catch { return fail('invalid PR repository URL'); }
  const host = kind === 'github' ? 'github.com' : 'gitcode.com';
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)) fail('unsafe PR repository URL');
  const [owner, repo] = url.pathname.slice(1).replace(/\.git$/, '').split('/'); pathKey(owner!); pathKey(repo!);
  return `https://${host}/${owner}/${repo}.git`;
}
async function remoteCommits(target: Extract<EvidenceTarget, { kind: 'github' | 'gitcode' }>): Promise<{ base: string; head: string; mergeBase: string }> {
  const parsed = prUrl(target.kind, target.url);
  const endpoint = target.kind === 'github' ? `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`
    : `https://api.gitcode.com/api/v5/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;
  let response: Response;
  try { response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'User-Agent': 'dsh-codeasier-evidence' } }); }
  catch { return fail('public PR metadata unavailable'); }
  if (!response.ok) fail(`public PR metadata unavailable (HTTP ${response.status}); private/authenticated preparation requires a host adapter`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) fail('PR metadata exceeds byte budget');
  let value: unknown; try { value = JSON.parse(body); } catch { return fail('invalid PR metadata'); }
  const metadata = dataObject(value);
  if (metadata.number !== Number(parsed.number)) fail('PR metadata identity mismatch');
  const commits: Record<string, string> = Object.create(null) as Record<string, string>;
  const remotes: Record<string, string> = Object.create(null) as Record<string, string>;
  // Validate both sides before fetching anything. Deleted/inaccessible forks fail closed.
  for (const side of ['base', 'head'] as const) {
    const ref = dataObject(metadata[side]); const commit = sha(ref.sha);
    if (!ref.repo) fail(`PR ${side} repository unavailable; restore public commit access before retrying`);
    const repo = dataObject(ref.repo);
    const remote = repositoryUrl(target.kind, target.kind === 'github' ? repo.clone_url : repo.html_url);
    commits[side] = commit; remotes[side] = remote;
  }
  for (const side of ['base', 'head'] as const) {
    const commit = commits[side]!;
    try { await git(target.root, ['cat-file', '-e', `${commit}^{commit}`]); }
    catch { await fetchHistory(target.root, remotes[side]!, commit, '--depth=64'); }
    if (await revision(target.root, commit) !== commit) fail('fetched commit identity mismatch');
  }
  const base = commits.base!; const head = commits.head!;
  // Never substitute the destination tip or a moving branch when ancestry is missing.
  for (const deepen of [0, 64, 256, 1024]) {
    if (deepen) for (const side of ['base', 'head'] as const) {
      await fetchHistory(target.root, remotes[side]!, commits[side]!, `--deepen=${deepen}`);
    }
    let ancestors: string[] = [];
    try { ancestors = (await git(target.root, ['merge-base', '--all', base, head])).toString('utf8').trim().split('\n').filter(Boolean).map(sha); }
    catch { /* An absent merge-base may be a shallow boundary; never use a tip as fallback. */ }
    if (ancestors.length > 1) fail('PR has multiple merge-bases; resolve ambiguous ancestry before retrying');
    if (ancestors.length === 1) {
      const mergeBase = ancestors[0]!;
      // A shallow side branch can hide a better common ancestor, even when Git
      // already reports one. A parentless traversal entry whose actual commit
      // has parents is a shallow boundary, not a genuine unrelated root.
      const above = (await git(target.root, ['rev-list', '--parents', base, head, '--not', mergeBase])).toString('utf8').trim();
      let truncated = false;
      for (const line of above ? above.split('\n') : []) if (!line.includes(' ')) {
        const header = (await git(target.root, ['cat-file', '-p', sha(line)])).toString('utf8').split('\n\n', 1)[0]!;
        if (/^parent /m.test(header)) { truncated = true; break; }
      }
      if (!truncated) return { base, head, mergeBase };
    }
    if ((await git(target.root, ['rev-parse', '--is-shallow-repository'])).toString('utf8').trim() !== 'true') {
      fail('PR has no unambiguous common ancestry; cannot prepare a PR diff');
    }
  }
  return fail('PR merge-base unavailable within bounded shallow-history fetches; deepen both immutable commit histories before retrying');
}

async function fetchHistory(root: string, remote: string, commit: string, depth: string): Promise<void> {
  try { await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', depth, '--', remote, commit]); }
  catch { fail('public PR commit history unavailable; inaccessible or deleted forks require a host adapter'); }
}

/** Host preparation only. No credentials are read or sent; reviewers receive only frozen bytes. */
export async function prepareEvidence(target: EvidenceTarget, options: { notes?: readonly string[]; pack?: Readonly<Record<string, string>> } = {}): Promise<Snapshot> {
  // Snapshot caller-owned options before the first await so later parent mutation cannot alter evidence.
  const optionRecord = dataObject(options); keys(optionRecord, ['notes', 'pack']);
  if (options.notes !== undefined && !Array.isArray(options.notes)) fail('invalid notes');
  const notes = [...(options.notes ?? [])].map(note => text(note, 'note', 256 * 1024));
  const pack: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [path, content] of Object.entries(dataObject(options.pack ?? {}))) pack[pathKey(path)] = text(content as string, 'pack file');
  const input = { ...dataObject(target) };
  const root = await rootPath(input.root as string);
  let fixed: EvidenceTarget;
  let provenance: { base: string; head: string; mergeBase?: string };
  let captured: { diff: string; files: Record<string, string> };
  if (input.kind === 'local') {
    keys(input, ['kind', 'root']); fixed = { kind: 'local', root };
    const first = await localCapture(root); const second = await localCapture(root);
    if (JSON.stringify(first) !== JSON.stringify(second)) fail('workspace changed during capture');
    provenance = { base: first.head, head: first.head }; captured = first;
  } else if (input.kind === 'range') {
    keys(input, ['kind', 'root', 'base', 'head']);
    provenance = { base: await revision(root, input.base as string), head: await revision(root, input.head as string) };
    fixed = { kind: 'range', root, ...provenance }; captured = await rangeCapture(root, provenance.base, provenance.head);
  } else if (input.kind === 'github' || input.kind === 'gitcode') {
    keys(input, ['kind', 'root', 'url']); fixed = { kind: input.kind, root, url: prUrl(input.kind, input.url).url };
    provenance = await remoteCommits(fixed); captured = await rangeCapture(root, provenance.mergeBase!, provenance.head);
  } else return fail('unknown target kind');
  const reserved = new Set([
    ...paths(await git(root, ['ls-files', '--cached', '-z'])),
    ...paths(await git(root, ['ls-tree', '-r', '--name-only', '-z', provenance.base])),
    ...paths(await git(root, ['ls-tree', '-r', '--name-only', '-z', provenance.head])),
    ...(provenance.mergeBase ? paths(await git(root, ['ls-tree', '-r', '--name-only', '-z', provenance.mergeBase])) : []),
  ]);
  for (const [path, content] of Object.entries(pack)) {
    if (Object.hasOwn(captured.files, path) || reserved.has(path)) fail('pack may not replace repository evidence');
    captured.files[path] = content;
  }
  const body: Omit<Snapshot, 'id'> = { version: 1, target: fixed, diff: captured.diff, files: captured.files, notes, createdAt: Date.now(), provenance };
  return validateSnapshot({ id: digest(body), ...body });
}
