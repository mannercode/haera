import { randomUUID } from 'node:crypto';
import { putObject, ensureBucket } from './storage';

export const MAX_BYTES = 50 * 1024 * 1024; // 50MB per file

export function sanitizeFilename(name: string): string {
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
    throw new Error(
      `파일이 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB > 50MB)`,
    );
  }
  await ensureBucket();
  const safeName = sanitizeFilename(file.name);
  const id = randomUUID();
  // S3 object key, used as canonical storagePath in DB.
  const key = `uploads/${id}__${safeName}`;
  const arrayBuf = await file.arrayBuffer();
  await putObject(key, new Uint8Array(arrayBuf), file.type || undefined);
  return {
    filename: safeName,
    storagePath: key,
    size: file.size,
    mimeType: file.type || undefined,
  };
}
