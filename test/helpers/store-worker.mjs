import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { openReviewStore } from '../../src/store.ts';

const root = process.argv[2];
if (!root || resolve(root) !== root) throw new Error('Worker requires exact absolute ownership root');
const ctx = new Context();
let store;
try {
  await ctx.plugin(Storage);
  store = await openReviewStore(ctx, root);
  process.stdout.write('opened\n');
  process.stdout.write(`runtime:${store.runtimeId}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === 'close') break;
    const request = JSON.parse(line);
    if (request.kind === 'put') await store.put(request.record);
    else if (request.kind === 'update') await store.update(request.id, current => {
      const next = structuredClone(current); next.revision++; next.updatedAt++;
      next.audit.push({ at: next.updatedAt, action: 'worker_update', detail: '' }); return next;
    });
    else throw new Error('Unknown worker request');
    process.stdout.write('stored\n');
  }
  await store.close();
  await ctx.fiber.dispose();
  process.stdout.write('closed\n');
} catch {
  await store?.close().catch(() => {});
  await ctx.fiber.dispose().catch(() => {});
  process.stderr.write('native store worker failed\n');
  process.exitCode = 1;
}
