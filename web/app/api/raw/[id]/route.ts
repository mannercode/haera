import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, RawInput, RawStatus } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { trashDoc } from '@/lib/trash';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const doc = await db
    .collection<RawInput>('raw_inputs')
    .findOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json();
  const status = body?.status as RawStatus | undefined;
  if (!status || !['pending', 'processed', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }
  const db = await getDb();
  const update: Partial<RawInput> = {
    status,
    processedAt: status === 'processed' || status === 'failed' ? new Date() : undefined,
    error: typeof body?.error === 'string' ? body.error : undefined,
  };
  const result = await db
    .collection<RawInput>('raw_inputs')
    .updateOne(
      { _id: new ObjectId(id) as unknown as string, ownerId: owner },
      { $set: update },
    );
  return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
}

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
    .findOne({ _id: oid, ownerId: owner });
  if (doc) {
    await trashDoc(db, owner, 'raw', doc as unknown as { _id: unknown } & Record<string, unknown>);
  }
  const result = await db
    .collection<RawInput>('raw_inputs')
    .deleteOne({ _id: oid, ownerId: owner });
  return NextResponse.json({ deleted: result.deletedCount });
}
