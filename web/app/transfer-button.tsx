'use client';

import { useEffect, useState } from 'react';

type User = { _id: string; email: string; name: string };

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

  useEffect(() => {
    if (!open || users) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, [open, users]);

  async function transfer(toUserId: string) {
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, id, toUserId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `전달 실패 (${r.status})`);
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={
          className ?? 'text-xs text-zinc-400 hover:text-blue-700'
        }
        title="다른 사용자에게 전달"
      >
        ↪
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-30 mt-1 w-56 rounded border border-zinc-200 bg-white p-2 text-xs shadow-md"
        >
          <div className="mb-1 font-medium text-zinc-700">전달 대상 선택</div>
          {users === null ? (
            <div className="text-zinc-500">불러오는 중...</div>
          ) : users.length === 0 ? (
            <div className="text-zinc-500">전달 가능한 다른 사용자가 없습니다.</div>
          ) : (
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u._id}>
                  <button
                    disabled={submitting}
                    onClick={() => transfer(u._id)}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-blue-50 disabled:opacity-50"
                  >
                    {u.name}
                    <span className="ml-1 text-zinc-400">{u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="mt-1 text-red-700">{error}</div>}
          <button
            onClick={() => setOpen(false)}
            className="mt-2 text-zinc-500 hover:text-zinc-800"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}
