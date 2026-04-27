import { NextRequest, NextResponse } from 'next/server';
import { getSession } from './session';

const INTERNAL_TOKEN = (process.env.HAERA_INTERNAL_TOKEN ?? '').trim();
const INTERNAL_HEADER = 'x-haera-internal-token';
const OWNER_HEADER = 'x-haera-owner-id';

/**
 * Resolve the requesting user's id. Returns the id string, or a 401 NextResponse.
 *
 * Two paths:
 *  1. Browser session cookie (normal users via UI).
 *  2. Internal token + owner-id headers, used by spawned Claude processes that
 *     curl back into our API. The spawned process is started by the server
 *     itself with the user already known, so this just shuttles that identity
 *     through the local-only HTTP boundary.
 */
export async function requireOwner(req: NextRequest): Promise<string | NextResponse> {
  if (INTERNAL_TOKEN) {
    const token = req.headers.get(INTERNAL_HEADER);
    if (token && token === INTERNAL_TOKEN) {
      const ownerId = req.headers.get(OWNER_HEADER);
      if (ownerId) return ownerId;
    }
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return session.userId;
}

export function isAuthResponse(v: string | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}
