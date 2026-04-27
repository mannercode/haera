'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type User = { _id: string; email: string; name: string };

export function SendToOthersButton({
  text,
  disabled,
  onSent,
}: {
  text: string;
  disabled?: boolean;
  /** Called after /api/send succeeds. mode lets parent decide if it should
   *  also fire /api/process locally (share semantics). */
  onSent?: (info: { mode: 'transfer' | 'share' }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<User[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'transfer' | 'share'>('transfer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  function toggle(id: string) {
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function send() {
    if (selectedIds.length === 0 || !text.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, recipientIds: selectedIds, mode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `보내기 실패 (${r.status})`);
      setOpen(false);
      setSelectedIds([]);
      onSent?.({ mode });
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || !text.trim()}
        onClick={() => setOpen(true)}
        className="rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        title="다른 사용자에게 전달 또는 공유"
      >
        → 다른 사람에게
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
                <h3 className="text-sm font-semibold">다른 사람에게 보내기</h3>
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
                  ? '받는 사람만 받고, 본인 워크스페이스에는 저장되지 않습니다.'
                  : '받는 사람도 받고, 본인 워크스페이스에서도 처리됩니다.'}
              </p>

              <div className="mb-2 text-xs font-medium text-zinc-700">받는 사람</div>
              {users === null ? (
                <p className="text-sm text-zinc-500">불러오는 중...</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-zinc-500">다른 사용자가 없습니다.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {users.map((u) => {
                    const checked = selectedIds.includes(u._id);
                    return (
                      <li key={u._id}>
                        <label
                          className={
                            'flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ' +
                            (checked
                              ? 'border-blue-300 bg-blue-50'
                              : 'border-zinc-200 bg-white hover:bg-zinc-50')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(u._id)}
                          />
                          <span className="flex-1">
                            <span className="font-medium">{u.name}</span>
                            <span className="ml-2 text-xs text-zinc-500">{u.email}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {error && <p className="mt-2 text-xs text-red-700">에러: {error}</p>}

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={submitting || selectedIds.length === 0 || !text.trim()}
                  onClick={send}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {submitting
                    ? '보내는 중...'
                    : `${selectedIds.length}명에게 ${mode === 'transfer' ? '전달' : '공유'}`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
