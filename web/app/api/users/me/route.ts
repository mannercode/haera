import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDb, User } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({
    user: {
      _id: session.userId,
      email: session.email,
      name: session.name,
      isAdmin: !!session.isAdmin,
    },
  });
}

export async function DELETE() {
  // For listing other users (transfer recipient picker). Returns minimal info.
  return NextResponse.json({ error: 'use GET' }, { status: 405 });
}

export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ users: [] });
  }
  const db = await getDb();
  const docs = await db
    .collection<User>('users')
    .find({}, { projection: { passwordHash: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return NextResponse.json({
    users: docs.map((u) => ({
      _id: String(u._id),
      email: u.email,
      name: u.name,
    })),
  });
}
