import { NextResponse } from 'next/server';
import { startLoginSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const { id, url } = await startLoginSession();
    return NextResponse.json({ id, url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
