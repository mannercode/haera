import { NextRequest, NextResponse } from 'next/server';
import { getDb, Attachment } from '@/lib/mongodb';
import { saveUploadedFile } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll('files').filter((f) => f instanceof File) as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });
  }

  const db = await getDb();
  const saved: Attachment[] = [];
  for (const f of files) {
    try {
      const meta = await saveUploadedFile(f);
      const doc: Attachment = {
        ...meta,
        createdAt: new Date(),
      };
      const result = await db.collection<Attachment>('attachments').insertOne(doc);
      saved.push({ _id: String(result.insertedId), ...doc });
    } catch (e) {
      return NextResponse.json(
        { error: `${f.name}: ${(e as Error).message}` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ attachments: saved });
}

export async function GET() {
  const db = await getDb();
  const docs = await db
    .collection<Attachment>('attachments')
    .find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return NextResponse.json(docs);
}
