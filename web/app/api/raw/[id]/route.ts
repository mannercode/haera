import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, RawInput, RawStatus } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .updateOne({ _id: new ObjectId(id) as unknown as string }, { $set: update });
  return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const result = await db
    .collection<RawInput>('raw_inputs')
    .deleteOne({ _id: new ObjectId(id) as unknown as string });
  return NextResponse.json({ deleted: result.deletedCount });
}
