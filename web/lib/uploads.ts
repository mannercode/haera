import { mkdir, writeFile, stat as fsStat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const UPLOAD_DIR = '/var/haera/uploads';
export const MAX_BYTES = 50 * 1024 * 1024; // 50MB per file

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  // Strip path separators and control chars; keep extension/Korean chars.
  const cleaned = name
    .replace(/[/\\\x00-\x1f]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 200) || 'unnamed';
}

export async function saveUploadedFile(
  file: File,
): Promise<{
  filename: string;
  storagePath: string;
  size: number;
  mimeType?: string;
}> {
  if (file.size === 0) throw new Error('빈 파일');
  if (file.size > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB > 50MB)`);
  }
  await ensureUploadDir();
  const safeName = sanitizeFilename(file.name);
  const id = randomUUID();
  const stored = `${id}__${safeName}`;
  const storagePath = path.join(UPLOAD_DIR, stored);
  const arrayBuf = await file.arrayBuffer();
  await writeFile(storagePath, new Uint8Array(arrayBuf));
  return {
    filename: safeName,
    storagePath,
    size: file.size,
    mimeType: file.type || undefined,
  };
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fsStat(p);
    return true;
  } catch {
    return false;
  }
}
