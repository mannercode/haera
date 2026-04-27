'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type User = { _id: string; email: string; name: string };
type Mode = 'transfer' | 'share';

export function TransferButton({
  type,
  id,
  onDone,
  className,
}: {
  type: 'task' | 'note' | 'raw';
  id: string;
  onDone?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>('transfer');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || users) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, [open, users]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(toUserId: string) {
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, id, toUserId, mode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `실패 (${r.status})`);
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? 'text-xs text-zinc-400 hover:text-blue-700'}
        title="다른 사용자에게 전달 또는 공유"
        aria-label="전달/공유"
      >
        ↪
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/30 p-4"
            onMouseDown={() => setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-md border border-zinc-300 bg-white p-4 shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">전달 / 공유</h3>
                <button
                  onClick={() => setOpen(false)}
                  className="text-zinc-400 hover:text-zinc-700"
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>

              <div className="mb-3 flex gap-1 rounded border border-zinc-200 p-1">
                <button
                  type="button"
                  onClick={() => setMode('transfer')}
                  className={
                    'flex-1 rounded px-2 py-1 text-xs font-medium ' +
                    (mode === 'transfer'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 hover:bg-zinc-100')
                  }
                >
                  전달
                </button>
                <button
                  type="button"
                  onClick={() => setMode('share')}
                  className={
                    'flex-1 rounded px-2 py-1 text-xs font-medium ' +
                    (mode === 'share'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 hover:bg-zinc-100')
                  }
                >
                  공유
                </button>
              </div>
              <p className="mb-3 text-[11px] text-zinc-500">
                {mode === 'transfer'
                  ? '내 워크스페이스에서 빠지고 받는 사람으로 이동합니다.'
                  : '받는 사람에게 사본이 생기고, 내 항목은 그대로 남습니다.'}
              </p>

              {users === null ? (
                <p className="text-sm text-zinc-500">불러오는 중...</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-zinc-500">전달 가능한 다른 사용자가 없습니다.</p>
              ) : (
                <ul className="space-y-1">
                  {users.map((u) => (
                    <li key={u._id}>
                      <button
                        disabled={submitting}
                        onClick={() => send(u._id)}
                        className="block w-full rounded border border-zinc-200 bg-white px-3 py-2 text-left text-sm hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                      >
                        <span className="font-medium">{u.name}</span>
                        <span className="ml-2 text-xs text-zinc-500">{u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {error && (
                <p className="mt-2 text-xs text-red-700">에러: {error}</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
