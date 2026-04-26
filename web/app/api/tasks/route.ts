import { NextRequest, NextResponse } from 'next/server';
import { getDb, Task, TaskStatus } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const status = (req.nextUrl.searchParams.get('status') as TaskStatus | null) ?? undefined;
  const db = await getDb();
  const filter = status ? { status } : {};
  const docs = await db
    .collection<Task>('tasks')
    .find(filter)
    .sort({ deadline: 1, createdAt: -1 })
    .limit(500)
    .toArray();
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const deadline = body?.deadline ? new Date(body.deadline) : null;
  const sourceIds: string[] = [];
  if (Array.isArray(body?.sourceRawIds)) {
    for (const x of body.sourceRawIds) if (typeof x === 'string' && x) sourceIds.push(x);
  }
  if (typeof body?.sourceRawId === 'string' && body.sourceRawId) sourceIds.push(body.sourceRawId);
  const dedupSources = Array.from(new Set(sourceIds));
  const doc: Task = {
    title,
    deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
    description: typeof body?.description === 'string' ? body.description : undefined,
    sourceRawIds: dedupSources.length > 0 ? dedupSources : undefined,
    priority: ['low', 'normal', 'high'].includes(body?.priority) ? body.priority : 'normal',
    status: 'todo',
    createdAt: new Date(),
  };
  const db = await getDb();
  const result = await db.collection<Task>('tasks').insertOne(doc);
  return NextResponse.json({ _id: result.insertedId, ...doc });
}
