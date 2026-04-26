import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Note } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json();
  const update: Partial<Note> = {};
  const ops: Record<string, unknown> = {};
  if (typeof body?.title === 'string') update.title = body.title.trim();
  if (typeof body?.content === 'string') update.content = body.content.trim();
  if (Array.isArray(body?.tags)) {
    update.tags = body.tags
      .filter((t: unknown) => typeof t === 'string' && t.trim())
      .map((t: string) => t.trim());
  }
  if (Array.isArray(body?.addSourceRawIds) && body.addSourceRawIds.length > 0) {
    const ids = (body.addSourceRawIds as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (ids.length > 0) {
      ops.$addToSet = { sourceRawIds: { $each: ids } };
    }
  }
  if (Array.isArray(body?.sourceRawIds)) {
    update.sourceRawIds = (body.sourceRawIds as unknown[]).filter(
      (x): x is string => typeof x === 'string',
    );
  }
  if (Object.keys(update).length > 0) ops.$set = update;
  const db = await getDb();
  if (Object.keys(ops).length === 0) {
    return NextResponse.json({ matched: 0, modified: 0 });
  }
  const result = await db
    .collection<Note>('notes')
    .updateOne({ _id: new ObjectId(id) as unknown as string }, ops);
  return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const result = await db
    .collection<Note>('notes')
    .deleteOne({ _id: new ObjectId(id) as unknown as string });
  return NextResponse.json({ deleted: result.deletedCount });
}
