import { fileURLToPath } from 'node:url';
import { inspectPlugins } from './lib/plugins.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2];
try {
  if (!['list', 'check'].includes(action) || process.argv.length !== 3) throw new Error('Usage: node scripts/plugins.mjs <list|check>');
  const plugins = await inspectPlugins(root);
  if (action === 'list') {
    for (const plugin of plugins) console.log(`${plugin.id}\t${plugin.kind}\t${plugin.status}\t${plugin.kind === 'native' ? plugin.entry : plugin.skill}`);
  } else console.log(`Validated ${plugins.length} plugin descriptors, exports and native patch identities.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
