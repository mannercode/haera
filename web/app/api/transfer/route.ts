import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Note, RawInput, Task, User } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kind = 'task' | 'note' | 'raw';

const COLLECTIONS: Record<Kind, string> = {
  task: 'tasks',
  note: 'notes',
  raw: 'raw_inputs',
};

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const body = await req.json().catch(() => ({}));
  const type = body?.type as Kind | undefined;
  const id = typeof body?.id === 'string' ? body.id : '';
  const toUserId = typeof body?.toUserId === 'string' ? body.toUserId : '';
  if (!type || !COLLECTIONS[type]) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  if (!ObjectId.isValid(id) || !ObjectId.isValid(toUserId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  if (toUserId === owner) {
    return NextResponse.json({ error: '본인에게 전달할 수 없습니다' }, { status: 400 });
  }

  const db = await getDb();
  const recipient = await db
    .collection<User>('users')
    .findOne({ _id: new ObjectId(toUserId) as unknown as string });
  if (!recipient) {
    return NextResponse.json({ error: '받는 사용자가 없습니다' }, { status: 404 });
  }

  const coll = COLLECTIONS[type];
  const result = await db
    .collection<Task | Note | RawInput>(coll)
    .updateOne(
      { _id: new ObjectId(id) as unknown as string, ownerId: owner },
      {
        $set: {
          ownerId: toUserId,
          transferredFrom: owner,
          transferredAt: new Date(),
        },
      },
    );

  if (result.matchedCount === 0) {
    return NextResponse.json(
      { error: '대상 항목을 찾지 못했습니다 (권한 또는 존재 여부)' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
