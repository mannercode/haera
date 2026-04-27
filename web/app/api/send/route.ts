import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, RawInput, User } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const mode = body?.mode === 'share' ? 'share' : 'transfer';
  const recipientIds = Array.isArray(body?.recipientIds)
    ? (body.recipientIds as unknown[]).filter(
        (x): x is string => typeof x === 'string' && ObjectId.isValid(x),
      )
    : [];
  if (!text) {
    return NextResponse.json({ error: '내용을 입력해주세요' }, { status: 400 });
  }
  if (recipientIds.length === 0) {
    return NextResponse.json({ error: '받는 사람을 선택해주세요' }, { status: 400 });
  }
  if (recipientIds.includes(owner)) {
    return NextResponse.json(
      { error: '본인에게는 보낼 수 없습니다' },
      { status: 400 },
    );
  }

  const db = await getDb();
  const recipients = await db
    .collection<User>('users')
    .find({
      _id: { $in: recipientIds.map((s) => new ObjectId(s) as unknown as string) },
    })
    .toArray();
  if (recipients.length !== recipientIds.length) {
    return NextResponse.json({ error: '존재하지 않는 사용자가 있습니다' }, { status: 404 });
  }

  const now = new Date();
  const docs: RawInput[] = recipients.map((r) => ({
    ownerId: String(r._id),
    content: text,
    createdAt: now,
    status: 'pending',
    transferredFrom: owner,
    transferredAt: now,
    transferMode: mode,
  }));
  const result = await db.collection<RawInput>('raw_inputs').insertMany(docs);

  return NextResponse.json({
    sent: result.insertedCount,
    recipients: recipients.map((r) => ({ _id: String(r._id), name: r.name })),
  });
}
