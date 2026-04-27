import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Transfer, User } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const sp = req.nextUrl.searchParams;
  const direction = sp.get('direction'); // 'sent' | 'received' | null (both)
  const limit = Math.min(
    500,
    Math.max(1, parseInt(sp.get('limit') ?? '200', 10) || 200),
  );

  const db = await getDb();
  const filter: Record<string, unknown> =
    direction === 'sent'
      ? { fromUserId: owner }
      : direction === 'received'
        ? { toUserId: owner }
        : { $or: [{ fromUserId: owner }, { toUserId: owner }] };

  const docs = await db
    .collection<Transfer>('transfers')
    .find(filter)
    .sort({ at: -1 })
    .limit(limit)
    .toArray();

  const userIds = Array.from(
    new Set(docs.flatMap((d) => [d.fromUserId, d.toUserId])),
  );
  const users = userIds.length
    ? await db
        .collection<User>('users')
        .find(
          {
            _id: {
              $in: userIds.map((s) => new ObjectId(s) as unknown as string),
            },
          },
          { projection: { passwordHash: 0 } },
        )
        .toArray()
    : [];
  const userById = new Map(
    users.map((u) => [String(u._id), { _id: String(u._id), name: u.name, email: u.email }]),
  );

  return NextResponse.json({
    items: docs.map((d) => ({
      _id: String(d._id),
      from: userById.get(d.fromUserId) ?? null,
      to: userById.get(d.toUserId) ?? null,
      type: d.type,
      mode: d.mode,
      sourceItemId: d.sourceItemId ?? null,
      targetItemId: d.targetItemId,
      title: d.title ?? null,
      contentSnippet: d.contentSnippet ?? null,
      at: d.at instanceof Date ? d.at.toISOString() : new Date(d.at).toISOString(),
      direction: d.fromUserId === owner ? 'sent' : 'received',
    })),
  });
}
