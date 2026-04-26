import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb, Note, RawInput, Task, getSourceRawIds } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

type Kind = 'task' | 'note' | 'raw';

type Source = { _id: string; content: string; createdAt: string | null };

type FamilyMember =
  | {
      type: 'task';
      _id: string;
      title: string;
      deadline: string | null;
      status: string;
      description?: string;
      isSelf?: boolean;
    }
  | {
      type: 'note';
      _id: string;
      title: string;
      content: string;
      tags?: string[];
      isSelf?: boolean;
    };

function toIso(v: Date | string | undefined | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as Kind | null;
  const id = sp.get('id');
  if (!type || !id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'type and valid id required' }, { status: 400 });
  }
  const oid = new ObjectId(id) as unknown as string;
  const db = await getDb();

  let rawIds: string[] = [];

  if (type === 'task') {
    const t = await db.collection<Task>('tasks').findOne({ _id: oid });
    if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
    rawIds = getSourceRawIds(t);
  } else if (type === 'note') {
    const n = await db.collection<Note>('notes').findOne({ _id: oid });
    if (!n) return NextResponse.json({ error: 'not found' }, { status: 404 });
    rawIds = getSourceRawIds(n);
  } else if (type === 'raw') {
    rawIds = [String(id)];
  }

  const sources: Source[] = [];
  const familyMap = new Map<string, FamilyMember>();

  for (const rid of rawIds) {
    if (!ObjectId.isValid(rid)) continue;
    const rawOid = new ObjectId(rid) as unknown as string;
    const raw = await db.collection<RawInput>('raw_inputs').findOne({ _id: rawOid });
    if (!raw) continue;
    sources.push({
      _id: String(raw._id),
      content: raw.content,
      createdAt: toIso(raw.createdAt),
    });
    // Tasks/notes whose sourceRawIds includes this rid OR (legacy) sourceRawId equals it.
    const matchFilter = {
      $or: [{ sourceRawIds: rid }, { sourceRawId: rid }],
    } as Record<string, unknown>;
    const [tasks, notes] = await Promise.all([
      db.collection<Task>('tasks').find(matchFilter).sort({ createdAt: 1 }).toArray(),
      db.collection<Note>('notes').find(matchFilter).sort({ createdAt: 1 }).toArray(),
    ]);
    for (const t of tasks) {
      const key = `task:${t._id}`;
      if (familyMap.has(key)) continue;
      familyMap.set(key, {
        type: 'task',
        _id: String(t._id),
        title: t.title,
        deadline: toIso(t.deadline),
        status: t.status,
        description: t.description,
        isSelf: type === 'task' && String(t._id) === String(id),
      });
    }
    for (const n of notes) {
      const key = `note:${n._id}`;
      if (familyMap.has(key)) continue;
      familyMap.set(key, {
        type: 'note',
        _id: String(n._id),
        title: n.title,
        content: n.content,
        tags: n.tags,
        isSelf: type === 'note' && String(n._id) === String(id),
      });
    }
  }

  return NextResponse.json({ sources, family: Array.from(familyMap.values()) });
}
