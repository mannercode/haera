'use client';

import { useEffect, useMemo, useState } from 'react';

type Bookmark = {
  _id: string;
  title: string;
  url: string;
  folder: string;
  source?: string;
  tags?: string[];
  clickCount: number;
  lastClickedAt: string | null;
};

const TOP_LIMIT = 12;

export function BookmarksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await fetch('/api/bookmarks?limit=1000').then((r) => r.json());
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.folder.toLowerCase().includes(q) ||
        (b.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [items, query]);

  // Top by click count (only those with clicks > 0).
  const top = useMemo(
    () =>
      [...filtered]
        .filter((b) => b.clickCount > 0)
        .sort((a, b) => {
          if (b.clickCount !== a.clickCount) return b.clickCount - a.clickCount;
          return (b.lastClickedAt ?? '').localeCompare(a.lastClickedAt ?? '');
        })
        .slice(0, TOP_LIMIT),
    [filtered],
  );

  // Group rest by folder; within each folder show all (folder header on top).
  const folders = useMemo(() => {
    const topUrls = new Set(top.map((t) => t.url));
    const m = new Map<string, Bookmark[]>();
    for (const b of filtered) {
      if (topUrls.has(b.url)) continue;
      const arr = m.get(b.folder) ?? [];
      arr.push(b);
      m.set(b.folder, arr);
    }
    // Sort folders by total click count desc, then alphabetically.
    return [...m.entries()].sort((a, b) => {
      const aTotal = a[1].reduce((s, x) => s + x.clickCount, 0);
      const bTotal = b[1].reduce((s, x) => s + x.clickCount, 0);
      if (aTotal !== bTotal) return bTotal - aTotal;
      return a[0].localeCompare(b[0], 'ko');
    });
  }, [filtered, top]);

  if (!open) return null;

  function onCardClick(url: string) {
    fetch('/api/bookmarks/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => {});
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/30 p-4 sm:p-12"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-md border border-zinc-300 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 p-3">
          <h2 className="whitespace-nowrap text-base font-semibold">즐겨찾기</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="제목/URL/폴더/태그 검색"
            className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          />
          <span className="text-xs text-zinc-500">{filtered.length}건</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[80vh] space-y-4 overflow-y-auto p-3">
          {loading ? (
            <p className="text-sm text-zinc-500">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-400">
              {query ? '검색 결과 없음' : '저장된 즐겨찾기가 없습니다.'}
            </p>
          ) : (
            <>
              {top.length > 0 && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    ★ 자주 가는
                  </h3>
                  <BookmarkGrid items={top} onCardClick={onCardClick} />
                </section>
              )}
              {folders.map(([folder, list]) => (
                <section key={folder}>
                  <h3 className="mb-1 text-xs font-semibold text-zinc-500">
                    📁 {folder}
                    <span className="ml-1 font-normal text-zinc-400">({list.length})</span>
                  </h3>
                  <BookmarkGrid items={list} onCardClick={onCardClick} />
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function BookmarkGrid({
  items,
  onCardClick,
}: {
  items: Bookmark[];
  onCardClick: (url: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((b) => {
        const h = host(b.url);
        return (
          <li key={b._id}>
            <a
              href={b.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onCardClick(b.url)}
              title={b.url}
              className="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 hover:border-blue-300 hover:bg-blue-50/40"
            >
              {h && (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${h}&sz=32`}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 shrink-0 rounded-sm"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
