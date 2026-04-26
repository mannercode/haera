import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { TOKEN_FILE } from './auth';

export async function getClaudeToken(): Promise<string | undefined> {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = (await readFile(TOKEN_FILE, 'utf8')).trim();
    return fromFile || undefined;
  } catch {
    return undefined;
  }
}

export async function askClaude(
  prompt: string,
  opts: { timeoutMs?: number; allowBash?: boolean } = {},
): Promise<string> {
  const { timeoutMs = 180_000, allowBash = false } = opts;
  const token = await getClaudeToken();
  if (!token) throw new Error('Claude not authenticated');

  const args = ['--print', '--model', 'claude-opus-4-7', '--effort', 'max'];
  if (allowBash) args.push('--allowedTools', 'Bash');

  return new Promise<string>((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: token,
        TERM: 'dumb',
        NO_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    proc.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });

    proc.stdin.end(prompt);
  });
}
