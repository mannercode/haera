import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb, User } from '@/lib/mongodb';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const expectedCode = (process.env.SIGNUP_CODE ?? '').trim();

export async function POST(req: NextRequest) {
  if (!expectedCode) {
    return NextResponse.json(
      { error: 'SIGNUP_CODE 환경변수가 설정되지 않았습니다' },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: '올바른 이메일을 입력해주세요' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '비밀번호는 6자 이상' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: '이름을 입력해주세요' }, { status: 400 });
  }
  if (code !== expectedCode) {
    return NextResponse.json({ error: '인증 코드가 올바르지 않습니다' }, { status: 403 });
  }

  const db = await getDb();
  const users = db.collection<User>('users');
  const exists = await users.findOne({ email });
  if (exists) {
    return NextResponse.json({ error: '이미 가입된 이메일입니다' }, { status: 409 });
  }
  const isFirstUser = (await users.countDocuments({})) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const doc: User = {
    email,
    passwordHash,
    name,
    isAdmin: isFirstUser,
    createdAt: new Date(),
  };
  const result = await users.insertOne(doc);
  const userId = String(result.insertedId);

  // First user inherits all pre-existing data (one-time bootstrap migration).
  if (isFirstUser) {
    await Promise.all([
      db
        .collection('raw_inputs')
        .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: userId } }),
      db
        .collection('tasks')
        .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: userId } }),
      db
        .collection('notes')
        .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: userId } }),
      db
        .collection('attachments')
        .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: userId } }),
      db
        .collection('bookmark_clicks')
        .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: userId } }),
    ]);
  }

  const session = await getSession();
  session.userId = userId;
  session.email = email;
  session.name = name;
  session.isAdmin = !!doc.isAdmin;
  await session.save();

  return NextResponse.json({
    user: { _id: userId, email, name, isAdmin: !!doc.isAdmin },
  });
}
