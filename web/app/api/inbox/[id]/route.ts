import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, RawInput } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { trashDoc } from '@/lib/trash';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Reject incoming item → soft-delete to trash so it's restorable.
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
    .collection<RawInput>('raw_inputs')
    .findOne({ _id: oid, ownerId: owner, transferredFrom: { $exists: true } });
  if (doc) {
    await trashDoc(db, owner, 'raw', doc as unknown as { _id: unknown } & Record<string, unknown>);
  }
  const result = await db
    .collection<RawInput>('raw_inputs')
    .deleteOne({ _id: oid, ownerId: owner, transferredFrom: { $exists: true } });
  return NextResponse.json({ deleted: result.deletedCount });
}

// Mark accepted: just clear the inbox pending state by setting status='processed'.
// Caller is expected to also call /api/process with the content to actually run it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const result = await db
    .collection<RawInput>('raw_inputs')
    .updateOne(
      { _id: new ObjectId(id) as unknown as string, ownerId: owner },
      { $set: { status: 'processed', processedAt: new Date() } },
    );
  return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
}
