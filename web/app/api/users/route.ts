import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDb, User } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// List all users (minus the caller). Used by transfer recipient picker.
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const db = await getDb();
  const docs = await db
    .collection<User>('users')
    .find({}, { projection: { passwordHash: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return NextResponse.json({
    users: docs
      .filter((u) => String(u._id) !== session.userId)
      .map((u) => ({ _id: String(u._id), email: u.email, name: u.name })),
  });
}
