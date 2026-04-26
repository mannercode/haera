import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getDb, Attachment } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const doc = await db
    .collection<Attachment>('attachments')
    .findOne({ _id: new ObjectId(id) as unknown as string });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const buf = await readFile(doc.storagePath);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const doc = await db
    .collection<Attachment>('attachments')
    .findOne({ _id: new ObjectId(id) as unknown as string });
  if (!doc) return NextResponse.json({ deleted: 0 });
  // Best-effort filesystem delete; ignore if file already gone.
  try {
    if (doc.storagePath.startsWith(path.resolve('/var/haera/uploads'))) {
      await unlink(doc.storagePath);
    }
  } catch {
    /* ignore */
  }
  const res = await db
    .collection<Attachment>('attachments')
    .deleteOne({ _id: new ObjectId(id) as unknown as string });
  return NextResponse.json({ deleted: res.deletedCount });
}
