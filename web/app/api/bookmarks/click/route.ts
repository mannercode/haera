import { NextRequest, NextResponse } from 'next/server';
import { getDb, BookmarkClick } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  const db = await getDb();
  await db.collection<BookmarkClick>('bookmark_clicks').updateOne(
    { _id: url },
    { $inc: { count: 1 }, $set: { lastAt: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
