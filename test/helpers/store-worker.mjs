import { resolve } from 'node:path';
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
  await new Promise(resolveClose => {
    process.stdin.once('data', resolveClose);
    process.stdin.once('end', resolveClose);
  });
  await store.close();
  await ctx.fiber.dispose();
  process.stdout.write('closed\n');
} catch {
  await store?.close().catch(() => {});
  await ctx.fiber.dispose().catch(() => {});
  process.stderr.write('native store worker failed\n');
  process.exitCode = 1;
}
