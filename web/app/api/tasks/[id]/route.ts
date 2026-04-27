import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Task, TaskStatus } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';
import { trashDoc } from '@/lib/trash';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = new Set([
  'status',
  'title',
  'description',
  'deadline',
  'priority',
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

  // Strict field validation: reject anything unrecognized so callers don't
  // accidentally silently no-op (e.g. "dueDate" instead of "deadline").
  const unknownFields = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      {
        error: `unknown field(s): ${unknownFields.join(', ')}. allowed: ${Array.from(ALLOWED_FIELDS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  const update: Partial<Task> = {};
  const ops: Record<string, unknown> = {};
  if (body?.status !== undefined) {
    if (!['todo', 'done'].includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    update.status = body.status as TaskStatus;
  }
  if (body?.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'title must be non-empty string' }, { status: 400 });
    }
    update.title = body.title.trim();
  }
  if (body?.description !== undefined) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be string' }, { status: 400 });
    }
    update.description = body.description;
  }
  if (body?.deadline !== undefined) {
    if (body.deadline === null) {
      update.deadline = null;
    } else if (typeof body.deadline === 'string') {
      const d = new Date(body.deadline);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: `invalid deadline: ${body.deadline}` },
          { status: 400 },
        );
      }
      update.deadline = d;
    } else {
      return NextResponse.json(
        { error: 'deadline must be ISO8601 string or null' },
        { status: 400 },
      );
    }
  }
  if (body?.priority !== undefined) {
    if (!['low', 'normal', 'high'].includes(body.priority)) {
      return NextResponse.json(
        { error: 'priority must be low|normal|high' },
        { status: 400 },
      );
    }
    update.priority = body.priority;
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
    .collection<Task>('tasks')
    .updateOne({ _id: oid, ownerId: owner }, ops);
  if (result.matchedCount === 0) {
    return NextResponse.json(
      { error: 'task not found or not owned by current user' },
      { status: 404 },
    );
  }
  // Return the updated doc so callers can verify the actual stored values.
  const updatedDoc = await db.collection<Task>('tasks').findOne({ _id: oid });
  return NextResponse.json({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    task: updatedDoc,
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
  const doc = await db.collection<Task>('tasks').findOne({ _id: oid, ownerId: owner });
  if (doc) {
    await trashDoc(db, owner, 'task', doc as unknown as { _id: unknown } & Record<string, unknown>);
  }
  const result = await db
    .collection<Task>('tasks')
    .deleteOne({ _id: oid, ownerId: owner });
  return NextResponse.json({ deleted: result.deletedCount });
}
