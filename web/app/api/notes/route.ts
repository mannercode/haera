import { NextRequest, NextResponse } from 'next/server';
import { getDb, Note } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  const tag = req.nextUrl.searchParams.get('tag')?.trim() ?? '';
  const db = await getDb();

  const filter: Record<string, unknown> = {};
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: re }, { content: re }, { tags: re }];
  }
  if (tag) filter.tags = tag;

  const docs = await db
    .collection<Note>('notes')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!title || !content) {
    return NextResponse.json({ error: 'title and content required' }, { status: 400 });
  }
  const tags = Array.isArray(body?.tags)
    ? body.tags
        .filter((t: unknown) => typeof t === 'string' && t.trim())
        .map((t: string) => t.trim())
    : undefined;
  const doc: Note = {
    title,
    content,
    tags,
    sourceRawId: typeof body?.sourceRawId === 'string' ? body.sourceRawId : undefined,
    createdAt: new Date(),
  };
  const db = await getDb();
  const result = await db.collection<Note>('notes').insertOne(doc);
  return NextResponse.json({ _id: result.insertedId, ...doc });
}
