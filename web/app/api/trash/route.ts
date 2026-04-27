import { NextRequest, NextResponse } from 'next/server';
import { getDb, TrashItem } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const db = await getDb();
  const docs = await db
    .collection<TrashItem>('trash')
    .find({ ownerId: owner })
    .sort({ deletedAt: -1 })
    .limit(500)
    .toArray();
  return NextResponse.json({
    items: docs.map((d) => ({
      _id: String(d._id),
      kind: d.kind,
      originalId: d.originalId,
      title:
        (d.payload?.title as string | undefined) ??
        (d.payload?.filename as string | undefined) ??
        (typeof d.payload?.content === 'string'
          ? (d.payload.content as string).split('\n')[0].slice(0, 60)
          : '(이름 없음)'),
      contentSnippet:
        typeof d.payload?.content === 'string'
          ? (d.payload.content as string).slice(0, 200)
          : typeof d.payload?.description === 'string'
            ? (d.payload.description as string).slice(0, 200)
            : null,
      deletedAt:
        d.deletedAt instanceof Date
          ? d.deletedAt.toISOString()
          : new Date(d.deletedAt).toISOString(),
    })),
  });
}
