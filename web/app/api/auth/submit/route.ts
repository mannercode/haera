import { NextRequest, NextResponse } from 'next/server';
import { submitLoginCode } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { id, code } = await req.json();
    if (!id || !code) {
      return NextResponse.json({ error: 'id and code required' }, { status: 400 });
    }
    await submitLoginCode(id, code);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
