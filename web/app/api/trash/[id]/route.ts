import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, TrashItem, TrashKind, Attachment } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { deleteObject, isLegacyLocalPath } from '@/lib/storage';
import { unlink } from 'node:fs/promises';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLL_BY_KIND: Record<TrashKind, string> = {
  task: 'tasks',
  note: 'notes',
  raw: 'raw_inputs',
  attachment: 'attachments',
};

// Permanent purge: remove from trash, drop S3 object for attachments.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const oid = new ObjectId(id) as unknown as string;
  const doc = await db
    .collection<TrashItem>('trash')
    .findOne({ _id: oid, ownerId: owner });
  if (!doc) return NextResponse.json({ purged: 0 });
  if (doc.kind === 'attachment') {
    const att = doc.payload as Partial<Attachment>;
    if (att.storagePath) {
      try {
        if (isLegacyLocalPath(att.storagePath)) {
          if (att.storagePath.startsWith('/var/haera/uploads/')) {
            await unlink(att.storagePath).catch(() => {});
          }
        } else {
          await deleteObject(att.storagePath);
        }
      } catch {
        /* best effort */
      }
    }
  }
  const r = await db
    .collection<TrashItem>('trash')
    .deleteOne({ _id: oid, ownerId: owner });
  return NextResponse.json({ purged: r.deletedCount });
}
