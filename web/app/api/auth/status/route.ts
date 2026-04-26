import { NextResponse } from 'next/server';
import { tokenFileExists } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authenticated = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').length > 0
    || (await tokenFileExists());
  return NextResponse.json({ authenticated });
}
