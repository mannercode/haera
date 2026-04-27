import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb, User } from '@/lib/mongodb';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) {
    return NextResponse.json({ error: '이메일과 비밀번호를 입력해주세요' }, { status: 400 });
  }
  const db = await getDb();
  const user = await db.collection<User>('users').findOne({ email });
  if (!user) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
  }
  const session = await getSession();
  session.userId = String(user._id);
  session.email = user.email;
  session.name = user.name;
  session.isAdmin = !!user.isAdmin;
  await session.save();

  return NextResponse.json({
    user: {
      _id: String(user._id),
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin,
    },
  });
}
