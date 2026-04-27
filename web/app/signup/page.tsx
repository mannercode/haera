'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/users/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, code }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `가입 실패 (${r.status})`);
      router.push('/');
      router.refresh();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold text-zinc-900">가입</h1>
      <p className="mt-1 text-sm text-zinc-500">관리자에게 받은 4자리 인증 코드가 필요합니다.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
          autoComplete="name"
          required
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          autoComplete="email"
          required
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 (6자 이상)"
          autoComplete="new-password"
          required
          minLength={6}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
          placeholder="인증 코드 (4자리)"
          inputMode="numeric"
          required
          maxLength={4}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-center font-mono text-base tracking-widest"
        />
        {error && <div className="text-xs text-red-700">{error}</div>}
        <button
          type="submit"
          disabled={loading || code.length !== 4}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? '가입 중...' : '가입'}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-500">
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="text-blue-700 hover:underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
