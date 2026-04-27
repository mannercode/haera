import { NextRequest, NextResponse } from 'next/server';
import { getDb, BookmarkClick } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const body = await req.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  const db = await getDb();
  // Compose key: per-owner so users don't share counters.
  const key = `${owner}::${url}`;
  await db.collection<BookmarkClick>('bookmark_clicks').updateOne(
    { _id: key },
    { $inc: { count: 1 }, $set: { lastAt: new Date(), ownerId: owner } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
