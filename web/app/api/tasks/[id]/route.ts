import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Task, TaskStatus } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json();
  const update: Partial<Task> = {};
  const ops: Record<string, unknown> = {};
  if (body?.status && ['todo', 'done'].includes(body.status)) {
    update.status = body.status as TaskStatus;
  }
  if (body?.title) update.title = String(body.title);
  if (typeof body?.description === 'string') update.description = body.description;
  if (body?.deadline !== undefined) {
    const d = body.deadline ? new Date(body.deadline) : null;
    update.deadline = d && !isNaN(d.getTime()) ? d : null;
  }
  if (body?.priority && ['low', 'normal', 'high'].includes(body.priority)) {
    update.priority = body.priority;
  }
  // Multi-source append: { addSourceRawIds: ["raw1","raw2"] } adds without dup.
  if (Array.isArray(body?.addSourceRawIds) && body.addSourceRawIds.length > 0) {
    const ids = (body.addSourceRawIds as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (ids.length > 0) {
      ops.$addToSet = { sourceRawIds: { $each: ids } };
    }
  }
  // Replace full sourceRawIds array.
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
    .collection<Task>('tasks')
    .updateOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner }, ops);
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
  const result = await db
    .collection<Task>('tasks')
    .deleteOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
  return NextResponse.json({ deleted: result.deletedCount });
}
