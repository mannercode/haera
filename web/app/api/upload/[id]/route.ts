import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { readFile, unlink } from 'node:fs/promises';
import { getDb, Attachment } from '@/lib/mongodb';
import { deleteObject, getObjectBuffer, isLegacyLocalPath } from '@/lib/storage';

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
    const buf = isLegacyLocalPath(doc.storagePath)
      ? await readFile(doc.storagePath)
      : await getObjectBuffer(doc.storagePath);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'file missing or unreadable', detail: (e as Error).message },
      { status: 410 },
    );
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
  try {
    if (isLegacyLocalPath(doc.storagePath)) {
      // Legacy local file
      if (doc.storagePath.startsWith('/var/haera/uploads/')) {
        await unlink(doc.storagePath).catch(() => {});
      }
    } else {
      await deleteObject(doc.storagePath);
    }
  } catch {
    /* best effort */
  }
  const res = await db
    .collection<Attachment>('attachments')
    .deleteOne({ _id: new ObjectId(id) as unknown as string });
  return NextResponse.json({ deleted: res.deletedCount });
}
