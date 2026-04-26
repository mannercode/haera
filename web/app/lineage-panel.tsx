'use client';

import { useEffect, useState } from 'react';

type Source = { _id: string; content: string; createdAt: string | null };
type Family =
  | {
      type: 'task';
      _id: string;
      title: string;
      deadline: string | null;
      status: string;
      description?: string;
      isSelf?: boolean;
    }
  | {
      type: 'note';
      _id: string;
      title: string;
      tags?: string[];
      isSelf?: boolean;
    };

type Lineage = { sources: Source[]; family: Family[] };

function fmtDateTime(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LineagePanel({
  type,
  id,
}: {
  type: 'task' | 'note' | 'raw';
  id: string;
}) {
  const [data, setData] = useState<Lineage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/lineage?type=${type}&id=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  if (loading) return <div className="text-xs text-zinc-500">출처 불러오는 중...</div>;
  if (error) return <div className="text-xs text-red-700">{error}</div>;
  if (!data) return null;
  if (!data.sources || data.sources.length === 0) {
    return <div className="text-xs text-zinc-500">출처 정보 없음</div>;
  }

  const others = data.family.filter((f) => !f.isSelf);

  return (
    <div className="mt-2 space-y-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
      {data.sources.map((s, i) => (
        <div key={s._id}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            원본 입력{data.sources.length > 1 ? ` ${i + 1}/${data.sources.length}` : ''} ·{' '}
            {fmtDateTime(s.createdAt)}
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-sans text-zinc-700">
            {s.content}
          </pre>
        </div>
      ))}
      {others.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            같은 원본에서 만들어진 항목
          </div>
          <ul className="space-y-1">
            {others.map((f) => (
              <li key={`${f.type}:${f._id}`} className="flex items-start gap-2">
                <span
                  className={
                    'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ' +
                    (f.type === 'task'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800')
                  }
                >
                  {f.type === 'task' ? '할 일' : '노트'}
                </span>
                <span className="flex-1 text-zinc-700">
                  {f.title}
                  {f.type === 'task' && f.deadline && (
                    <span className="ml-2 text-zinc-500">
                      ({fmtDateTime(f.deadline)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
