import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import {
  getDb,
  Note,
  RawInput,
  Task,
  Attachment,
  Transfer,
  TrashItem,
  User,
} from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

type HistoryItem = {
  type: 'note' | 'raw' | 'task' | 'attachment' | 'transfer' | 'trash';
  _id: string;
  title: string;
  content: string;
  tags?: string[];
  status?: string;
  deadline?: string | null;
  createdAt: string;
  error?: string;
  size?: number;
  mimeType?: string;
  // Raw-specific: Claude의 응답 (답변/처리 보고)
  response?: string;
  // Transfer-specific
  transferDirection?: 'sent' | 'received';
  transferMode?: 'transfer' | 'share';
  transferPartner?: string;
  transferTargetType?: string;
  // Trash-specific
  trashKind?: 'task' | 'note' | 'raw' | 'attachment';
  deletedAt?: string;
  trashOriginalId?: string;
};

function toIso(v: Date | string | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const type = sp.get('type')?.trim() ?? '';
  const tag = sp.get('tag')?.trim() ?? '';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(5, parseInt(sp.get('limit') ?? '50', 10) || 50));

  const db = await getDb();
  const items: HistoryItem[] = [];
  const re = q
    ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : null;
  // Aggregate cap per collection to keep in-memory sort cheap.
  const PER_COLLECTION_CAP = 2000;

  if (!type || type === 'note') {
    const filter: Record<string, unknown> = { ownerId: owner };
    if (re) filter.$or = [{ title: re }, { content: re }, { tags: re }];
    if (tag) filter.tags = tag;
    const docs = await db
      .collection<Note>('notes')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    for (const n of docs) {
      items.push({
        type: 'note',
        _id: String(n._id),
        title: n.title,
        content: n.content,
        tags: n.tags,
        createdAt: toIso(n.createdAt),
      });
    }
  }

  if (!type || type === 'raw') {
    const filter: Record<string, unknown> = { ownerId: owner };
    if (re) filter.content = re;
    const docs = await db
      .collection<RawInput>('raw_inputs')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    for (const r of docs) {
      const firstLine = (r.content || '').split('\n')[0].trim();
      items.push({
        type: 'raw',
        _id: String(r._id),
        title: firstLine.slice(0, 60) || '(빈 내용)',
        content: r.content,
        response: r.response,
        status: r.status,
        createdAt: toIso(r.createdAt),
        error: r.error,
      });
    }
  }

  if (!type || type === 'task') {
    const filter: Record<string, unknown> = { ownerId: owner };
    if (re) filter.$or = [{ title: re }, { description: re }];
    const docs = await db
      .collection<Task>('tasks')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    for (const t of docs) {
      items.push({
        type: 'task',
        _id: String(t._id),
        title: t.title,
        content: t.description || '',
        status: t.status,
        deadline: t.deadline ? toIso(t.deadline) : null,
        createdAt: toIso(t.createdAt),
      });
    }
  }

  if (!type || type === 'attachment') {
    const filter: Record<string, unknown> = { ownerId: owner };
    if (re) filter.filename = re;
    const docs = await db
      .collection<Attachment>('attachments')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    for (const a of docs) {
      items.push({
        type: 'attachment',
        _id: String(a._id),
        title: a.filename,
        content: '',
        size: a.size,
        mimeType: a.mimeType,
        createdAt: toIso(a.createdAt),
      });
    }
  }

  // Transfer history — included in default ('전체') view.
  if (!type || type === 'transfer') {
    const filter: Record<string, unknown> = {
      $or: [{ fromUserId: owner }, { toUserId: owner }],
    };
    if (re) {
      filter.$and = [
        { $or: [{ title: re }, { contentSnippet: re }] },
      ];
    }
    const docs = await db
      .collection<Transfer>('transfers')
      .find(filter)
      .sort({ at: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    const partnerIds = Array.from(
      new Set(docs.flatMap((d) => [d.fromUserId, d.toUserId])),
    );
    const users = partnerIds.length
      ? await db
          .collection<User>('users')
          .find(
            {
              _id: {
                $in: partnerIds.map((s) => new ObjectId(s) as unknown as string),
              },
            },
            { projection: { passwordHash: 0 } },
          )
          .toArray()
      : [];
    const userById = new Map(users.map((u) => [String(u._id), u.name]));
    for (const d of docs) {
      const direction: 'sent' | 'received' =
        d.fromUserId === owner ? 'sent' : 'received';
      const partnerId = direction === 'sent' ? d.toUserId : d.fromUserId;
      const partnerName = userById.get(partnerId) ?? '알 수 없음';
      items.push({
        type: 'transfer',
        _id: String(d._id),
        title:
          d.title ??
          (direction === 'sent'
            ? `${partnerName}에게 ${d.mode === 'share' ? '공유' : '전달'}`
            : `${partnerName}에게서 ${d.mode === 'share' ? '공유받음' : '전달받음'}`),
        content: d.contentSnippet ?? '',
        createdAt: toIso(d.at),
        transferDirection: direction,
        transferMode: d.mode,
        transferPartner: partnerName,
        transferTargetType: d.type,
      });
    }
  }

  // Trash items — included in default ('전체') view.
  if (!type || type === 'trash') {
    const filter: Record<string, unknown> = { ownerId: owner };
    if (re) {
      filter.$or = [
        { 'payload.title': re },
        { 'payload.content': re },
        { 'payload.filename': re },
        { 'payload.description': re },
      ];
    }
    const docs = await db
      .collection<TrashItem>('trash')
      .find(filter)
      .sort({ deletedAt: -1 })
      .limit(PER_COLLECTION_CAP)
      .toArray();
    for (const d of docs) {
      const p = d.payload as Record<string, unknown>;
      const title =
        (p.title as string | undefined) ??
        (p.filename as string | undefined) ??
        (typeof p.content === 'string'
          ? (p.content as string).split('\n')[0].slice(0, 60)
          : '(이름 없음)');
      const content =
        typeof p.content === 'string'
          ? (p.content as string)
          : typeof p.description === 'string'
            ? (p.description as string)
            : '';
      items.push({
        type: 'trash',
        _id: String(d._id),
        title,
        content,
        trashKind: d.kind,
        trashOriginalId: d.originalId,
        deletedAt: toIso(d.deletedAt),
        createdAt: toIso(d.deletedAt),
      });
    }
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  return NextResponse.json({
    items: paged,
    total,
    page,
    limit,
    totalPages,
  });
}
