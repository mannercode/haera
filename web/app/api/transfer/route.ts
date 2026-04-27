import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import {
  getDb,
  Note,
  RawInput,
  Task,
  Transfer,
  User,
  TransferType,
  TransferMode,
} from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTIONS: Record<TransferType, string> = {
  task: 'tasks',
  note: 'notes',
  raw: 'raw_inputs',
  send: 'raw_inputs',
};

function snippetOf(s: string | undefined, n = 200): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const body = await req.json().catch(() => ({}));
  const rawType = body?.type as TransferType | undefined;
  const id = typeof body?.id === 'string' ? body.id : '';
  const toUserId = typeof body?.toUserId === 'string' ? body.toUserId : '';
  const mode: TransferMode = body?.mode === 'share' ? 'share' : 'transfer';
  if (!rawType || rawType === 'send' || !(rawType in COLLECTIONS)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const type = rawType as Exclude<TransferType, 'send'>;
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
  const original = await db
    .collection<Task | Note | RawInput>(coll)
    .findOne({ _id: new ObjectId(id) as unknown as string, ownerId: owner });
  if (!original) {
    return NextResponse.json(
      { error: '대상 항목을 찾지 못했습니다 (권한 또는 존재 여부)' },
      { status: 404 },
    );
  }

  const now = new Date();
  let targetItemId: string;
  let title: string | undefined;
  let contentSnippet: string | undefined;

  if (mode === 'transfer') {
    // Ownership change in place. raw 전달 시 파생 task/note는 보내지 않음 —
    // 받는 사람이 필요하면 재분석으로 직접 산출.
    await db
      .collection<Task | Note | RawInput>(coll)
      .updateOne(
        { _id: new ObjectId(id) as unknown as string, ownerId: owner },
        {
          $set: {
            ownerId: toUserId,
            transferredFrom: owner,
            transferredAt: now,
            transferMode: 'transfer',
          },
        },
      );
    targetItemId = id;
  } else {
    // Share = deep copy to recipient. Sender keeps original untouched.
    const copy: Record<string, unknown> = { ...original };
    delete copy._id;
    copy.ownerId = toUserId;
    copy.transferredFrom = owner;
    copy.transferredAt = now;
    copy.transferMode = 'share';
    copy.createdAt = now;
    if (type === 'raw') {
      // For shared raws, keep status pending so recipient can accept/reject.
      copy.status = 'pending';
      delete (copy as { processedAt?: unknown }).processedAt;
      delete (copy as { error?: unknown }).error;
    }
    const inserted = await db
      .collection<Task | Note | RawInput>(coll)
      .insertOne(copy as unknown as Task | Note | RawInput);
    targetItemId = String(inserted.insertedId);
  }

  // Snapshot title/content for the audit log.
  if ('title' in original && typeof original.title === 'string') {
    title = original.title;
  }
  if ('content' in original && typeof original.content === 'string') {
    contentSnippet = snippetOf(original.content);
  } else if ('description' in original && typeof original.description === 'string') {
    contentSnippet = snippetOf(original.description);
  }

  const log: Transfer = {
    fromUserId: owner,
    toUserId,
    type,
    mode,
    sourceItemId: id,
    targetItemId,
    title,
    contentSnippet,
    at: now,
  };
  await db.collection<Transfer>('transfers').insertOne(log);

  return NextResponse.json({ ok: true, mode });
}
