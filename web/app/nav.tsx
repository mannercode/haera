'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookmarksModal } from './bookmarks-modal';

const TABS = [
  { href: '/', label: 'haera' },
  { href: '/knowledge', label: '지식창고' },
];

type Me = { _id: string; email: string; name: string; isAdmin?: boolean };

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  // Hide entirely on the auth pages.
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const [authRes, meRes] = await Promise.all([
          fetch('/api/auth/status').then((r) => r.json()),
          fetch('/api/users/me').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setAuthed(!!authRes.authenticated);
        setMe(meRes.user ?? null);
      } catch {
        if (cancelled) return;
        setAuthed(false);
        setMe(null);
      }
    }
    if (!isAuthPage) {
      check();
      const id = setInterval(check, 10000);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthPage]);

  async function logout() {
    await fetch('/api/users/logout', { method: 'POST' });
    setMe(null);
    router.push('/login');
    router.refresh();
  }

  if (isAuthPage) return null;

  return (
    <>
      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4">
          <button
            onClick={() => setBookmarksOpen(true)}
            className="my-1 mr-2 rounded px-3 py-1 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
            title="즐겨찾기 열기"
          >
            ★ 즐겨찾기
          </button>
          <span className="mr-2 h-5 w-px bg-zinc-200" aria-hidden />
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  'border-b-2 px-3 py-2 text-sm font-medium transition ' +
                  (active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-zinc-600 hover:text-zinc-900')
                }
              >
                {t.label}
              </Link>
            );
          })}
          <span
            className={
              'ml-auto text-xs ' +
              (authed === null
                ? 'text-zinc-400'
                : authed
                  ? 'text-emerald-600'
                  : 'text-amber-600')
            }
          >
            {authed === null ? '...' : authed ? '● Claude 인증됨' : '● Claude 인증 필요'}
          </span>
          {me && (
            <>
              <span className="ml-3 text-xs text-zinc-500">{me.name}</span>
              <button
                onClick={logout}
                className="ml-2 text-xs text-zinc-500 hover:text-red-600"
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </nav>
      <BookmarksModal open={bookmarksOpen} onClose={() => setBookmarksOpen(false)} />
    </>
  );
}
