import { spawn } from 'node:child_process';

export interface IsolatedExecuteOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}
export interface IsolatedExecuteResult { stdout: string; stderr: string }
export class IsolatedExecuteError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | string | null;
  readonly signal: NodeJS.Signals | null;
  constructor(reason: string, output: IsolatedExecuteResult, code: number | string | null, signal: NodeJS.Signals | null) {
    super(`${reason}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`);
    this.name = 'IsolatedExecuteError';
    this.stdout = output.stdout; this.stderr = output.stderr;
    this.code = code; this.signal = signal;
  }
}

/** Test-only installer runner. No shell; a new POSIX process group owns descendants. */
export function executeIsolated(file: string, args: readonly string[], options: IsolatedExecuteOptions): Promise<IsolatedExecuteResult> {
  const timeout = options.timeout ?? 120_000;
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) return Promise.reject(new RangeError('timeout must be a positive safe timer duration'));
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0 || maxBuffer > 64 * 1024 * 1024) return Promise.reject(new RangeError('maxBuffer must be between 1 byte and 64 MiB'));
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, detached: grouped, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = Buffer.allocUnsafe(maxBuffer), stderr = Buffer.allocUnsafe(maxBuffer);
    let stdoutBytes = 0, stderrBytes = 0;
    let failure: { reason: string; code: number | string | null } | undefined;
    let cleanupError: string | undefined;
    let killed = false;
    let timer: NodeJS.Timeout | undefined;
    let pipeDrain: NodeJS.Timeout | undefined;
    const output = (): IsolatedExecuteResult => ({ stdout: stdout.subarray(0, stdoutBytes).toString('utf8'), stderr: stderr.subarray(0, stderrBytes).toString('utf8') });
    const killOwnedTree = () => {
      if (killed || child.pid === undefined) return;
      killed = true;
      try {
        if (grouped) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupError = error instanceof Error ? error.message : String(error);
      }
      // A descendant that explicitly escaped the owned group can retain pipe
      // descriptors. Bound pipe drainage without accepting incomplete success.
      pipeDrain = setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); }, 1000);
    };
    const fail = (reason: string, code: number | string | null) => {
      failure ??= { reason, code };
      if (timer) clearTimeout(timer);
      killOwnedTree();
    };
    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const destination = stream === 'stdout' ? stdout : stderr;
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const copied = Math.min(chunk.length, maxBuffer - used);
      if (copied) chunk.copy(destination, used, 0, copied);
      if (stream === 'stdout') stdoutBytes += copied; else stderrBytes += copied;
      if (chunk.length > copied) fail(`Isolated command ${file}: ${stream} exceeded maxBuffer ${maxBuffer}`, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.stdout.on('error', error => fail(`Isolated command ${file}: stdout error: ${error.message}`, (error as NodeJS.ErrnoException).code ?? 'EIO'));
    child.stderr.on('error', error => fail(`Isolated command ${file}: stderr error: ${error.message}`, (error as NodeJS.ErrnoException).code ?? 'EIO'));
    child.on('error', error => fail(`Isolated command ${file} could not start: ${error.message}`, (error as NodeJS.ErrnoException).code ?? 'ESPAWN'));
    child.on('exit', (code, signal) => {
      // Exit precedes close; failed parents may leave descendants holding pipes.
      if (code !== 0) fail(`Isolated command ${file} exited with code ${code}, signal ${signal}`, code);
    });
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (pipeDrain) clearTimeout(pipeDrain);
      const captured = output();
      if (failure) {
        const reason = cleanupError ? `${failure.reason}; process-tree cleanup failed: ${cleanupError}` : failure.reason;
        reject(new IsolatedExecuteError(reason, captured, failure.code, signal));
      } else if (code !== 0) {
        reject(new IsolatedExecuteError(`Isolated command ${file} closed with code ${code}, signal ${signal}`, captured, code, signal));
      } else resolve(captured);
    });
    timer = setTimeout(() => fail(`Isolated command ${file} timed out after ${timeout}ms`, 'ETIMEDOUT'), timeout);
  });
}
