'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Item = {
  type: 'note' | 'raw' | 'task' | 'attachment';
  _id: string;
  title: string;
  content: string;
  tags?: string[];
  status?: string;
  deadline?: string | null;
  createdAt: string;
  error?: string;
  size?: number;
  mimeType?: string;
};

type SearchResponse = {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const TYPES: { key: '' | 'note' | 'raw' | 'task' | 'attachment'; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'note', label: '참고정보' },
  { key: 'raw', label: '원본' },
  { key: 'task', label: '할 일' },
  { key: 'attachment', label: '첨부' },
];

const TYPE_BADGE: Record<Item['type'], { label: string; cls: string }> = {
  note: { label: '참고정보', cls: 'bg-emerald-100 text-emerald-800' },
  raw: { label: '원본', cls: 'bg-zinc-200 text-zinc-700' },
  task: { label: '할 일', cls: 'bg-blue-100 text-blue-800' },
  attachment: { label: '첨부', cls: 'bg-purple-100 text-purple-800' },
};

function fmtSize(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const PAGE_SIZE = 50;

function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function fmtDate(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

function KnowledgeInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const urlQ = sp.get('q') ?? '';
  const urlType = (sp.get('type') ?? '') as '' | 'note' | 'raw' | 'task' | 'attachment';
  const urlTag = sp.get('tag') ?? '';
  const urlPage = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);

  const [queryInput, setQueryInput] = useState(urlQ);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Sync local input if URL changes externally (e.g. back button).
  useEffect(() => {
    setQueryInput(urlQ);
  }, [urlQ]);

  // Helper to build a new URL with updated params; resets page to 1 on filter change.
  const navigate = useCallback(
    (changes: Record<string, string | null>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage) next.delete('page');
      const qs = next.toString();
      router.push(qs ? `/knowledge?${qs}` : '/knowledge');
    },
    [router, sp],
  );

  // Debounced query input → URL.
  useEffect(() => {
    if (queryInput === urlQ) return;
    const id = setTimeout(() => {
      navigate({ q: queryInput || null }, { resetPage: true });
    }, 250);
    return () => clearTimeout(id);
  }, [queryInput, urlQ, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (urlQ) params.set('q', urlQ);
    if (urlType) params.set('type', urlType);
    if (urlTag) params.set('tag', urlTag);
    params.set('page', String(urlPage));
    params.set('limit', String(PAGE_SIZE));
    try {
      const r = await fetch(`/api/search?${params}`).then((r) => r.json());
      setData(r);
    } finally {
      setLoading(false);
    }
  }, [urlQ, urlType, urlTag, urlPage]);

  // Fetch on URL change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [load]);

  async function deleteItem(item: Item) {
    if (!confirm(`이 ${TYPE_BADGE[item.type].label} 항목을 삭제할까요?`)) return;
    const path =
      item.type === 'note'
        ? `/api/notes/${item._id}`
        : item.type === 'raw'
          ? `/api/raw/${item._id}`
          : item.type === 'attachment'
            ? `/api/upload/${item._id}`
            : `/api/tasks/${item._id}`;
    await fetch(path, { method: 'DELETE' });
    await load();
  }

  async function copyItem(item: Item, key: string) {
    const toCopy = item.content || item.title;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch (e) {
      console.error('clipboard write failed', e);
    }
  }

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">지식창고</h1>
        <p className="text-sm text-zinc-500">
          모든 이력 — 참고정보, 입력 원본, 할 일을 통합 검색합니다.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
        <input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="제목/내용/태그 검색"
          className="w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() =>
                navigate({ type: t.key || null }, { resetPage: true })
              }
              className={cls(
                'rounded border px-3 py-1 text-xs font-medium transition',
                urlType === t.key
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100',
              )}
            >
              {t.label}
            </button>
          ))}
          {urlTag && (
            <button
              onClick={() => navigate({ tag: null }, { resetPage: true })}
              className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-200"
            >
              #{urlTag} ✕
            </button>
          )}
          <span className="text-xs text-zinc-500">
            {loading ? '검색 중...' : `총 ${total}건`}
            {totalPages > 1 && ` · ${urlPage}/${totalPages}쪽`}
          </span>
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-sm text-zinc-400">
          {urlQ || urlType || urlTag ? '검색 결과 없음' : '아직 저장된 항목이 없습니다.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const key = `${item.type}:${item._id}`;
            const isOpen = expanded === key;
            const badge = TYPE_BADGE[item.type];
            return (
              <li
                key={key}
                onClick={() => setExpanded(isOpen ? null : key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded(isOpen ? null : key);
                  }
                }}
                className={cls(
                  'cursor-pointer rounded border p-3 transition',
                  isOpen
                    ? 'border-blue-300 bg-blue-50/40 shadow-sm'
                    : 'border-zinc-200 bg-white hover:border-blue-200 hover:bg-blue-50/30',
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cls(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyItem(item, key);
                    }}
                    className={cls(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
                      copied === key
                        ? 'text-emerald-600'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-blue-600',
                    )}
                    title={copied === key ? '복사됨' : '내용 복사'}
                    aria-label="복사"
                  >
                    {copied === key ? (
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-3.5 w-3.5"
                      >
                        <rect x="5" y="5" width="9" height="9" rx="1.5" />
                        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
                      </svg>
                    )}
                  </button>
                  <span className="flex-1 text-sm font-medium">{item.title}</span>
                  <span className="text-[10px] text-zinc-400">
                    {fmtDate(item.createdAt)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteItem(item);
                    }}
                    className="ml-2 text-xs text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>

                {(item.type === 'task' || item.type === 'raw') && (
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                    {item.status && (
                      <span
                        className={cls(
                          'rounded px-1.5 py-0.5',
                          item.status === 'done' && 'bg-zinc-100 text-zinc-500',
                          item.status === 'todo' && 'bg-blue-50 text-blue-700',
                          item.status === 'pending' && 'bg-amber-100 text-amber-800',
                          item.status === 'processed' && 'bg-zinc-100 text-zinc-500',
                          item.status === 'failed' && 'bg-red-100 text-red-700',
                        )}
                      >
                        {item.status}
                      </span>
                    )}
                    {item.deadline && <span>마감: {fmtDate(item.deadline)}</span>}
                  </div>
                )}

                {item.type === 'attachment' && (
                  <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-zinc-500">
                    <span>{fmtSize(item.size)}</span>
                    {item.mimeType && <span>{item.mimeType}</span>}
                    <a
                      href={`/api/upload/${item._id}`}
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:underline"
                    >
                      열기 ↗
                    </a>
                  </div>
                )}

                {item.content && (
                  <pre
                    className={cls(
                      'mt-2 whitespace-pre-wrap break-words font-sans text-xs text-zinc-700',
                      !isOpen && 'line-clamp-2',
                    )}
                  >
                    {item.content}
                  </pre>
                )}

                {item.error && (
                  <p className="mt-1 text-xs text-red-700">{item.error}</p>
                )}

                {item.tags && item.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate({ tag }, { resetPage: true });
                        }}
                        className={cls(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          urlTag === tag
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                        )}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-1 pt-2">
          <button
            disabled={urlPage <= 1}
            onClick={() => navigate({ page: String(urlPage - 1) })}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"
          >
            이전
          </button>
          {pageNumbers(urlPage, totalPages).map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e${i}`} className="px-2 text-xs text-zinc-400">
                ...
              </span>
            ) : (
              <button
                key={p}
                onClick={() => navigate({ page: String(p) })}
                className={cls(
                  'rounded border px-3 py-1 text-xs',
                  p === urlPage
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100',
                )}
              >
                {p}
              </button>
            ),
          )}
          <button
            disabled={urlPage >= totalPages}
            onClick={() => navigate({ page: String(urlPage + 1) })}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40"
          >
            다음
          </button>
        </nav>
      )}
    </main>
  );
}

export default function Knowledge() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">로딩 중...</div>}>
      <KnowledgeInner />
    </Suspense>
  );
}
