import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, RawInput, User } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const db = await getDb();
  const raws = await db
    .collection<RawInput>('raw_inputs')
    .find({
      ownerId: owner,
      transferredFrom: { $exists: true },
      status: 'pending',
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const senderIds = Array.from(
    new Set(raws.map((r) => r.transferredFrom).filter((x): x is string => !!x)),
  );
  const senders = senderIds.length
    ? await db
        .collection<User>('users')
        .find(
          {
            _id: {
              $in: senderIds.map((s) => new ObjectId(s) as unknown as string),
            },
          },
          { projection: { passwordHash: 0 } },
        )
        .toArray()
    : [];
  const senderById = new Map(
    senders.map((s) => [String(s._id), { _id: String(s._id), name: s.name, email: s.email }]),
  );

  return NextResponse.json({
    items: raws.map((r) => ({
      _id: String(r._id),
      content: r.content,
      mode: r.transferMode ?? 'transfer',
      sender: senderById.get(r.transferredFrom ?? '') ?? null,
      transferredAt:
        r.transferredAt instanceof Date
          ? r.transferredAt.toISOString()
          : r.transferredAt
            ? new Date(r.transferredAt).toISOString()
            : null,
    })),
  });
}
