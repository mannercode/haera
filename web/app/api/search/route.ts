import { NextRequest, NextResponse } from 'next/server';
import { getDb, Note, RawInput, Task, Attachment } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

type HistoryItem = {
  type: 'note' | 'raw' | 'task' | 'attachment';
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
