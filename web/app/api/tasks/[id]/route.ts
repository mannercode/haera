import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Task, TaskStatus } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json();
  const update: Partial<Task> = {};
  if (body?.status && ['todo', 'done'].includes(body.status)) {
    update.status = body.status as TaskStatus;
  }
  if (body?.title) update.title = String(body.title);
  if (body?.deadline !== undefined) {
    const d = body.deadline ? new Date(body.deadline) : null;
    update.deadline = d && !isNaN(d.getTime()) ? d : null;
  }
  const db = await getDb();
  const result = await db
    .collection<Task>('tasks')
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
    .collection<Task>('tasks')
    .deleteOne({ _id: new ObjectId(id) as unknown as string });
  return NextResponse.json({ deleted: result.deletedCount });
}
