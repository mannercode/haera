import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Note } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { trashDoc } from '@/lib/trash';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = new Set([
  'title',
  'content',
  'tags',
  'sourceRawIds',
  'addSourceRawIds',
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));

  const unknownFields = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      {
        error: `unknown field(s): ${unknownFields.join(', ')}. allowed: ${Array.from(ALLOWED_FIELDS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  const update: Partial<Note> = {};
  const ops: Record<string, unknown> = {};
  if (body?.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'title must be non-empty string' }, { status: 400 });
    }
    update.title = body.title.trim();
  }
  if (body?.content !== undefined) {
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be string' }, { status: 400 });
    }
    update.content = body.content.trim();
  }
  if (body?.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be array' }, { status: 400 });
    }
    update.tags = (body.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .map((t) => t.trim());
  }
  if (body?.sourceRawIds !== undefined) {
    if (!Array.isArray(body.sourceRawIds)) {
      return NextResponse.json({ error: 'sourceRawIds must be array' }, { status: 400 });
    }
    update.sourceRawIds = (body.sourceRawIds as unknown[]).filter(
      (x): x is string => typeof x === 'string',
    );
  }
  if (body?.addSourceRawIds !== undefined) {
    if (!Array.isArray(body.addSourceRawIds)) {
      return NextResponse.json({ error: 'addSourceRawIds must be array' }, { status: 400 });
    }
    const ids = (body.addSourceRawIds as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (ids.length > 0) {
      ops.$addToSet = { sourceRawIds: { $each: ids } };
    }
  }
  if (Object.keys(update).length > 0) ops.$set = update;
  if (Object.keys(ops).length === 0) {
    return NextResponse.json(
      { error: 'no recognized changes to apply' },
      { status: 400 },
    );
  }

  const db = await getDb();
  const oid = new ObjectId(id) as unknown as string;
  const result = await db
    .collection<Note>('notes')
    .updateOne({ _id: oid, ownerId: owner }, ops);
  if (result.matchedCount === 0) {
    return NextResponse.json(
      { error: 'note not found or not owned by current user' },
      { status: 404 },
    );
  }
  const updatedDoc = await db.collection<Note>('notes').findOne({ _id: oid });
  return NextResponse.json({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    note: updatedDoc,
  });
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
  const doc = await db.collection<Note>('notes').findOne({ _id: oid, ownerId: owner });
  if (doc) {
    await trashDoc(db, owner, 'note', doc as unknown as { _id: unknown } & Record<string, unknown>);
  }
  const result = await db
    .collection<Note>('notes')
    .deleteOne({ _id: oid, ownerId: owner });
  return NextResponse.json({ deleted: result.deletedCount });
}
