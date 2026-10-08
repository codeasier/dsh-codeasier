import { mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
import { randomUUID } from 'node:crypto';
import { defineDomain, domainTable, DomainFacility, type Domain } from '@deepseek-ai/dsh-storage-domain';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import '@deepseek-ai/dsh-storage';
import { parseRecord, runRecordSchema, type RunRecord } from './records.js';

export const reviewDomain = defineDomain({ name: 'cross_review', version: 1, layout: 'single', tables: { runs: domainTable<string, RunRecord>(runRecordSchema) } } as const);
export interface ReviewStore {
  readonly runtimeId: string;
  get(id: string): RunRecord | undefined;
  list(): RunRecord[];
  put(record: RunRecord): Promise<void>;
  update(id: string, transform: (current: RunRecord) => RunRecord): Promise<RunRecord>;
  recover(transform: (current: RunRecord) => RunRecord): Promise<RunRecord[]>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Short fresh-domain transactions plus one cooperative local runtime lease. */
export async function openReviewStore(ctx: Context, ownershipRoot: string): Promise<ReviewStore> {
  if (!ownershipRoot || resolve(ownershipRoot) !== ownershipRoot) throw new Error('Ownership root must be absolute');
  await mkdir(ownershipRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(ownershipRoot)).isSymbolicLink() || await realpath(ownershipRoot) !== ownershipRoot) throw new Error('Ownership root must not traverse symlinks');
  let release!: () => void;
  const released = new Promise<void>(resolveRelease => { release = resolveRelease; });
  const storage = ctx.get('storage', false);
  if (!storage) throw new Error('Native storage capability is unavailable');
  const runtimeId = randomUUID();
  const runtimePath = (id: string) => join(ownershipRoot, `cross-review-runtime-${id}`);
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const opened = new Promise<void>((resolveReady, rejectReady) => { ready = resolveReady; failed = rejectReady; });
  // Only this runtime's lease lasts until drain. Other DSH instances can start
  // against the same root, but cannot recover its live runs, even in the same PID.
  const lease = withFileLock(runtimePath(runtimeId), async () => { ready(); await released; })
    .catch(error => { failed(error); throw error; });
  void lease.catch(() => {});
  await opened;
  let records = new Map<string, RunRecord>();
  let closing = false;
  let closingPromise: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const check = () => { if (closing) throw new Error('Review store is closed'); };
  const transact = <T>(operation: (domain: Domain<typeof reviewDomain>) => Promise<T>): Promise<T> => {
    check();
    const task = pending.then(() => withFileLock(join(ownershipRoot, 'cross-review-owner'), async () => {
      // Cached JSON backends MUST NOT survive the root transaction lock. Reopen
      // and validate the committed domain before every write/recovery operation.
      const backend = new JsonStorageBackend(ownershipRoot);
      const backendName = `cross-review-${randomUUID()}`;
      const unregister = storage.backend.register(backendName, backend);
      let domain: Domain<typeof reviewDomain> | undefined;
      try {
        // Resolve the registered backend via its public name, never private routes.
        const facility = new DomainFacility(ctx, { backend: backendName });
        domain = await facility.open(reviewDomain);
        for (const [key, record] of domain.table('runs').entries()) {
          if (key !== record.id) throw new Error('Durable run key mismatch');
          parseRecord(record);
        }
        return await operation(domain);
      } finally {
        try {
          if (domain) records = new Map([...domain.table('runs').entries()].map(([id, record]) => [id, parseRecord(record)]));
        } finally {
          try { await domain?.close(); } finally { unregister(); await backend.close(); }
        }
      }
    }));
    pending = task.catch(() => {});
    return task;
  };
  const transformRecord = (current: RunRecord, transform: (current: RunRecord) => RunRecord): RunRecord => {
    const next = parseRecord(transform(parseRecord(current)));
    if (next.id !== current.id || next.revision !== current.revision + 1 || next.snapshot.id !== current.snapshot.id || next.owner.sessionId !== current.owner.sessionId || next.owner.project !== current.owner.project || next.owner.workspaceCwd !== current.owner.workspaceCwd || JSON.stringify(next.config) !== JSON.stringify(current.config)) throw new Error('Invalid immutable run transition');
    return next;
  };
  const isActive = async (id: string): Promise<boolean> => {
    if (id === runtimeId) return true;
    try { await withFileLock(runtimePath(id), async () => {}, { waitMs: 0 }); return false; }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('atomic-write: timed out waiting for the writer lock at ')) return true;
      throw error; // Unavailable liveness evidence never authorizes takeover.
    }
  };
  try { await transact(async () => {}); }
  catch (error) { release(); await lease; throw error; }
  return {
    runtimeId,
    get(id) { check(); return records.get(id); },
    list() { check(); return [...records.values()]; },
    put(record) { return transact(async domain => { const table = domain.table('runs'); const valid = parseRecord(record); if (table.get(valid.id)) throw new Error('Run already exists'); await table.put(valid.id, valid); }); },
    update(id, transform) { return transact(domain => domain.table('runs').update(id, current => transformRecord(current, transform))); },
    recover(transform) { return transact(async domain => {
      const recovered: RunRecord[] = [];
      const active = new Map<string, boolean>();
      const table = domain.table('runs');
      for (const [, previous] of table.entries()) {
        if (!active.has(previous.owner.runtimeId)) active.set(previous.owner.runtimeId, await isActive(previous.owner.runtimeId));
        if (active.get(previous.owner.runtimeId)) continue;
        recovered.push(await table.update(previous.id, current => transformRecord(current, transform)));
      }
      return recovered;
    }); },
    delete(id) { return transact(domain => domain.table('runs').delete(id)); },
    close() { return closingPromise ??= (async () => { closing = true; await pending; release(); await lease; })(); },
  };
}
