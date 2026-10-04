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
  get(id: string): RunRecord | undefined;
  list(): RunRecord[];
  put(record: RunRecord): Promise<void>;
  update(id: string, transform: (current: RunRecord) => RunRecord): Promise<RunRecord>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Cooperative same-host/PID-namespace ownership, held before opening cached data. */
export async function openReviewStore(ctx: Context, ownershipRoot: string): Promise<ReviewStore> {
  if (!ownershipRoot || resolve(ownershipRoot) !== ownershipRoot) throw new Error('Ownership root must be absolute');
  await mkdir(ownershipRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(ownershipRoot)).isSymbolicLink() || await realpath(ownershipRoot) !== ownershipRoot) throw new Error('Ownership root must not traverse symlinks');
  let release!: () => void;
  const released = new Promise<void>(resolveRelease => { release = resolveRelease; });
  let ready!: (domain: Domain<typeof reviewDomain>) => void;
  let failed!: (error: unknown) => void;
  const opened = new Promise<Domain<typeof reviewDomain>>((resolveReady, rejectReady) => { ready = resolveReady; failed = rejectReady; });
  const lock = withFileLock(join(ownershipRoot, 'cross-review-owner'), async () => {
    const storage = ctx.get('storage', false);
    if (!storage) throw new Error('Native storage capability is unavailable');
    // A dedicated public native backend/facility guarantees this lifetime lock
    // protects the same root that stores the domain (no private route inspection).
    const backend = new JsonStorageBackend(ownershipRoot);
    const backendName = `cross-review-${randomUUID()}`;
    const unregister = storage.backend.register(backendName, backend);
    const facility = new DomainFacility(ctx, { backend: backendName });
    let domain: Domain<typeof reviewDomain> | undefined;
    try {
      domain = await facility.open(reviewDomain);
      // Validate semantic evidence/result contracts in addition to native record shape.
      for (const [key, record] of domain.table('runs').entries()) {
        if (key !== record.id) throw new Error('Durable run key mismatch');
        parseRecord(record);
      }
      ready(domain);
      await released;
    } finally {
      try { await domain?.close(); } finally { unregister(); await backend.close(); }
    }
  }, { waitMs: 50 }).catch(error => { failed(error); throw error; });
  // Observe rejection immediately while the long-lived operation waits for disposal.
  void lock.catch(() => {});
  const domain = await opened;
  const table = domain.table('runs');
  let closing = false;
  let closingPromise: Promise<void> | undefined;
  const check = () => { if (closing) throw new Error('Review store is closed'); };
  return {
    get(id) { check(); const record = table.get(id); return record && parseRecord(record); },
    list() { check(); return [...table.entries()].map(([, record]) => parseRecord(record)); },
    async put(record) { check(); const valid = parseRecord(record); if (table.get(valid.id)) throw new Error('Run already exists'); await table.put(valid.id, valid); },
    async update(id, transform) {
      check();
      return table.update(id, current => {
        const next = parseRecord(transform(parseRecord(current)));
        if (next.id !== current.id || next.revision !== current.revision + 1 || next.snapshot.id !== current.snapshot.id || next.owner.sessionId !== current.owner.sessionId || next.owner.project !== current.owner.project || next.owner.workspaceCwd !== current.owner.workspaceCwd || JSON.stringify(next.config) !== JSON.stringify(current.config)) throw new Error('Invalid immutable run transition');
        return next;
      });
    },
    async delete(id) { check(); return table.delete(id); },
    close() { return closingPromise ??= (async () => { closing = true; release(); await lock; })(); },
  };
}
