import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  userId?: string;
  email?: string;
  name?: string;
  isAdmin?: boolean;
}

const password = process.env.SESSION_SECRET ?? '';

if (password.length > 0 && password.length < 32) {
  console.warn(
    '[haera] SESSION_SECRET is shorter than 32 chars; iron-session will reject it.',
  );
}

export const sessionOptions: SessionOptions = {
  cookieName: 'haera_session',
  password: password || 'placeholder-not-secure-fix-SESSION_SECRET-env-var--padded',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession();
  return session.userId ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new HttpAuthError('not authenticated');
  return id;
}

export class HttpAuthError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}
