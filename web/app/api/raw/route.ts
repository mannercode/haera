import { NextRequest, NextResponse } from 'next/server';
import { getDb, RawInput, RawStatus } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const status = (req.nextUrl.searchParams.get('status') as RawStatus | null) ?? undefined;
  const db = await getDb();
  const filter: Record<string, unknown> = { ownerId: owner };
  if (status) filter.status = status;
  const docs = await db
    .collection<RawInput>('raw_inputs')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const body = await req.json();
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  const db = await getDb();
  const doc: RawInput = {
    ownerId: owner,
    content,
    source: typeof body?.source === 'string' ? body.source : undefined,
    instructions:
      typeof body?.instructions === 'string' && body.instructions.trim()
        ? body.instructions.trim()
        : undefined,
    createdAt: new Date(),
    status: 'pending',
  };
  const result = await db.collection<RawInput>('raw_inputs').insertOne(doc);
  return NextResponse.json({ _id: result.insertedId, ...doc });
}
