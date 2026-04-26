import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const TOKEN_FILE = '/data/claude_token';
const SESSION_TTL_MS = 5 * 60 * 1000;
const URL_TIMEOUT_MS = 30_000;
const TOKEN_TIMEOUT_MS = 60_000;

interface Session {
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  expires: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var _haeraAuthSessions: Map<string, Session> | undefined;
}
const sessions = (global._haeraAuthSessions ??= new Map<string, Session>());

function killSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.expires);
  try {
    s.proc.kill();
  } catch {
    /* ignore */
  }
  sessions.delete(id);
}

export async function tokenFileExists(): Promise<boolean> {
  try {
    await stat(TOKEN_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function startLoginSession(): Promise<{ id: string; url: string }> {
  // Use `script` to allocate a PTY so the interactive CLI behaves normally.
  // Force a wide PTY (500 cols) so the OAuth URL isn't line-wrapped.
  const proc = spawn(
    'script',
    ['-qfc', 'stty cols 500 rows 50 2>/dev/null; claude setup-token', '/dev/null'],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'xterm',
        NO_COLOR: '1',
        COLUMNS: '500',
        LINES: '50',
      },
    },
  );
  const id = randomUUID();
  const session: Session = {
    proc,
    buffer: '',
    expires: setTimeout(() => killSession(id), SESSION_TTL_MS),
  };
  sessions.set(id, session);

  const append = (data: Buffer) => {
    session.buffer += data.toString('utf8');
  };
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('exit', () => {
    // mark as exited but keep buffer for /submit error reporting
  });

  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('login URL not received in time')), URL_TIMEOUT_MS);
    const tick = setInterval(() => {
      // Strip ANSI escapes and CR.
      const clean = session.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
      const m = clean.match(/https:\/\/[^\s)]+/);
      // Only accept the URL once it looks complete — Claude's OAuth URL must
      // include redirect_uri= and code_challenge= query params. If it's missing
      // them, the URL was probably truncated (still being printed); wait.
      if (m && m[0].includes('redirect_uri=') && m[0].includes('code_challenge=')) {
        clearTimeout(t);
        clearInterval(tick);
        resolve(m[0]);
      }
    }, 100);
    proc.on('exit', () => {
      clearTimeout(t);
      clearInterval(tick);
      reject(new Error(`process exited before URL: ${session.buffer.slice(-300)}`));
    });
  }).catch((e) => {
    killSession(id);
    throw e;
  });

  return { id, url };
}

export async function submitLoginCode(id: string, code: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) throw new Error('login session expired or invalid');

  // Don't reset the buffer — we want to keep prior context if needed for debug.
  const preLen = session.buffer.length;
  // Send code with both \r and \n to cover terminals that need either.
  session.proc.stdin.write(code.trim() + '\r\n');
  console.error('[auth] sent code, len:', code.trim().length);
  // Some flows ask "save this token? [Y/n]" — send a confirmation Enter after a delay.
  setTimeout(() => {
    try {
      session.proc.stdin.write('\r\n');
      console.error('[auth] sent follow-up enter');
    } catch {
      /* ignore */
    }
  }, 3000);

  const token = await new Promise<string>((resolve, reject) => {
    const cleanBuf = () =>
      session.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
    const t = setTimeout(() => {
      clearInterval(tick);
      const full = cleanBuf();
      const newOnly = full.slice(preLen);
      console.error('[auth] token timeout. NEW output after submit:', JSON.stringify(newOnly));
      console.error('[auth] FULL buffer:', JSON.stringify(full));
      reject(new Error(`token not received in time. new output: ${newOnly.slice(-500)}`));
    }, TOKEN_TIMEOUT_MS);
    const tick = setInterval(() => {
      const clean = cleanBuf();
      const m = clean.match(/sk-ant-oat01-[A-Za-z0-9_-]+/);
      if (m) {
        clearTimeout(t);
        clearInterval(tick);
        resolve(m[0]);
      }
    }, 100);
    session.proc.on('exit', () => {
      clearTimeout(t);
      clearInterval(tick);
      const clean = cleanBuf();
      const m = clean.match(/sk-ant-oat01-[A-Za-z0-9_-]+/);
      if (m) resolve(m[0]);
      else reject(new Error(`process exited without token. last output: ${clean.slice(-500)}`));
    });
  }).catch((e) => {
    killSession(id);
    throw e;
  });

  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  killSession(id);
}
