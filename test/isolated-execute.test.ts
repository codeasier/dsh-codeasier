import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { executeIsolated, IsolatedExecuteError } from './helpers/isolated-execute.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const options = { cwd, env: { PATH: process.env.PATH, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 5000, maxBuffer: 4096 };
const exec = promisify(execFile);

async function stopped(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
  // Grandchildren cannot be reaped by Node's child handle. Some init systems
  // retain them as zombies briefly; a zombie is stopped, not a live installer.
  try {
    const { stdout } = await exec('ps', ['-o', 'stat=', '-p', String(pid)], { timeout: 2000 });
    return stdout.trim() === '' || stdout.trim().startsWith('Z');
  } catch (error) {
    if ((error as { code?: number }).code === 1) return true;
    throw error;
  }
}

function descendantScript(exitNonzero: boolean): string {
  return `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify("process.on('SIGTERM', () => {}); console.log('DESCENDANT_READY:' + process.pid); setInterval(() => {}, 1000);")}], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      ${exitNonzero ? "process.stderr.write('parent-failure-diagnostic\\n'); process.exit(17);" : ''}
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    console.log('PARENT:' + process.pid);
    setInterval(() => {}, 1000);
  `;
}

async function expectTreeStopped(script: string, timeout: number, expectedCode: number | string): Promise<IsolatedExecuteError> {
  let failure: unknown;
  try { await executeIsolated(process.execPath, ['-e', script], { ...options, timeout }); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof IsolatedExecuteError);
  assert.equal(failure.code, expectedCode);
  const parent = Number(/PARENT:(\d+)/.exec(failure.stdout)?.[1]);
  const descendant = Number(/DESCENDANT_READY:(\d+)/.exec(failure.stdout)?.[1]);
  assert.ok(Number.isSafeInteger(parent) && parent > 1, failure.message);
  assert.ok(Number.isSafeInteger(descendant) && descendant > 1, failure.message);
  try {
    assert.equal(await stopped(parent), true, 'executor settles only after the parent closes');
    assert.equal(await stopped(descendant), true, 'a stopped parent must not leave a live descendant');
  } finally {
    // Only these explicitly spawned fixture identities are emergency-cleaned.
    for (const pid of [parent, descendant]) if (!await stopped(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  }
  return failure;
}

test('isolated executor captures successful stdout and stderr with supplied environment', async () => {
  const result = await executeIsolated(process.execPath, ['-e', "process.stdout.write(process.env.FIXTURE_VALUE); process.stderr.write('stderr-success');"], {
    ...options, env: { ...options.env, FIXTURE_VALUE: 'stdout-success' },
  });
  assert.deepEqual(result, { stdout: 'stdout-success', stderr: 'stderr-success' });
});

test('isolated executor kills a live descendant before rejecting timeout', { skip: process.platform === 'win32', timeout: 8000 }, async () => {
  const failure = await expectTreeStopped(descendantScript(false), 1000, 'ETIMEDOUT');
  assert.match(failure.message, /timed out after 1000ms/);
  assert.match(failure.message, /stdout:/);
});

test('nonzero parent exit kills descendants and preserves stderr diagnostics', { skip: process.platform === 'win32', timeout: 8000 }, async () => {
  const failure = await expectTreeStopped(descendantScript(true), 4000, 17);
  assert.equal(failure.stderr, 'parent-failure-diagnostic\n');
  assert.match(failure.message, /parent-failure-diagnostic/);
});

test('output limit keeps bounded bytes, kills the command and includes diagnostics', async () => {
  await assert.rejects(executeIsolated(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000);"], {
    ...options, maxBuffer: 128,
  }), (error: unknown) => {
    assert.ok(error instanceof IsolatedExecuteError);
    assert.equal(error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    assert.equal(Buffer.byteLength(error.stdout), 128);
    assert.match(error.message, /stdout exceeded maxBuffer 128/);
    return true;
  });
});

test('spawn errors retain their code and bounded diagnostics', async () => {
  await assert.rejects(executeIsolated('/definitely-not-an-isolated-executable', [], options), (error: unknown) => {
    assert.ok(error instanceof IsolatedExecuteError);
    assert.equal(error.code, 'ENOENT');
    assert.match(error.message, /could not start/);
    assert.equal(error.stdout, ''); assert.equal(error.stderr, '');
    return true;
  });
});
