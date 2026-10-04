"""Original test-only PTY bridge; all subprocesses inherit the isolated fixture home."""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

if len(sys.argv) < 2:
    raise SystemExit('PTY fixture needs an executable')

pid, master = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], dict(os.environ))

def terminate_child(_signum, _frame):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    raise SystemExit(1)

signal.signal(signal.SIGTERM, terminate_child)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 34, 120, 0, 0))
stdin_buffer = b''
query_buffer = b''
stdin_open = True
shutdown_deadline = None
try:
    while True:
        readers = [master]
        if stdin_open:
            readers.append(sys.stdin.fileno())
        timeout = None if shutdown_deadline is None else max(0, shutdown_deadline - time.monotonic())
        ready, _, _ = select.select(readers, [], [], timeout)
        if shutdown_deadline is not None and time.monotonic() >= shutdown_deadline:
            # Emergency cleanup is bounded; the test still fails unless graceful
            # shutdown returned exit code zero and emitted its disposal witness.
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            shutdown_deadline = None
        if master in ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            os.write(sys.stdout.fileno(), chunk)
            query_buffer += chunk
            # Answer ordinary terminal capability queries without emulating a UI.
            for query, response in [
                (b'\x1b[6n', b'\x1b[1;1R'),
                (b'\x1b]11;?\x07', b'\x1b]11;rgb:0000/0000/0000\x07'),
                (b'\x1b]10;?\x07', b'\x1b]10;rgb:ffff/ffff/ffff\x07'),
            ]:
                while query in query_buffer:
                    before, after = query_buffer.split(query, 1)
                    query_buffer = before + after
                    os.write(master, response)
            query_buffer = query_buffer[-64:]
        if stdin_open and sys.stdin.fileno() in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                stdin_open = False
                os.killpg(pid, signal.SIGTERM)
                continue
            stdin_buffer += data
            while b'\n' in stdin_buffer:
                line, stdin_buffer = stdin_buffer.split(b'\n', 1)
                if not line:
                    continue
                command = json.loads(line)
                if command.get('action') == 'write':
                    os.write(master, command['text'].encode('utf-8'))
                elif command.get('action') in ('stop', 'terminate'):
                    # The native TUI treats the first Ctrl+C as interruption or
                    # an exit confirmation. SIGTERM requests its graceful Host
                    # shutdown directly, after the fixture proves quiescence.
                    os.killpg(pid, signal.SIGTERM)
                    if shutdown_deadline is None:
                        shutdown_deadline = time.monotonic() + 15
                else:
                    raise ValueError('Unknown PTY fixture command')
finally:
    os.close(master)
    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        status = 0
    code = os.waitstatus_to_exitcode(status)
    sys.stderr.write('PTY_CHILD_EXIT=' + json.dumps({'pid': pid, 'code': code}) + '\n')
    sys.stderr.flush()
    raise SystemExit(0 if code == 0 else 1)
