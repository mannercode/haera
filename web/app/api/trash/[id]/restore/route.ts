import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, TrashItem, TrashKind } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLL_BY_KIND: Record<TrashKind, string> = {
  task: 'tasks',
  note: 'notes',
  raw: 'raw_inputs',
  attachment: 'attachments',
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (!doc) {
    return NextResponse.json({ error: '복원 대상이 없습니다' }, { status: 404 });
  }
  const coll = COLL_BY_KIND[doc.kind];
  if (!coll) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }
  // Re-insert with the original _id so existing references (sourceRawIds etc.) still resolve.
  const targetCollection = db.collection(coll);
  const restoredId = ObjectId.isValid(doc.originalId)
    ? new ObjectId(doc.originalId)
    : new ObjectId();
  try {
    await targetCollection.insertOne({
      ...(doc.payload as Record<string, unknown>),
      _id: restoredId,
      ownerId: owner,
    } as unknown as Parameters<typeof targetCollection.insertOne>[0]);
  } catch (e) {
    // Likely duplicate key (already exists). Surface a friendly error.
    return NextResponse.json(
      { error: '같은 ID의 항목이 이미 존재합니다', detail: String((e as Error).message) },
      { status: 409 },
    );
  }
  await db.collection<TrashItem>('trash').deleteOne({ _id: oid, ownerId: owner });
  return NextResponse.json({ restored: String(restoredId) });
}
