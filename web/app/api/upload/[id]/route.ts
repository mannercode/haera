import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { readFile } from 'node:fs/promises';
import { getDb, Attachment } from '@/lib/mongodb';
import { getObjectBuffer, isLegacyLocalPath } from '@/lib/storage';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { trashDoc } from '@/lib/trash';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const doc = await db
    .collection<Attachment>('attachments')
    .findOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const doc = await db
    .collection<Attachment>('attachments')
    .findOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
  if (!doc) return NextResponse.json({ deleted: 0 });
  // Soft delete: snapshot to trash; keep S3 object so restore can re-attach.
  // Permanent purge from /trash is what actually removes the bytes.
  await trashDoc(db, owner, 'attachment', doc as unknown as { _id: unknown } & Record<string, unknown>);
  const res = await db
    .collection<Attachment>('attachments')
    .deleteOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
  return NextResponse.json({ deleted: res.deletedCount });
}
