'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineagePanel } from './lineage-panel';
import { TransferButton } from './transfer-button';
import { SendToOthersButton } from './send-to-others-button';

type RawInput = {
  _id: string;
  content: string;
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
  processedAt?: string;
  error?: string;
  transferredFrom?: string;
  transferredAt?: string;
  transferMode?: 'transfer' | 'share';
};

type Task = {
  _id: string;
  title: string;
  deadline?: string | null;
  description?: string;
  priority?: 'low' | 'normal' | 'high';
  status: 'todo' | 'done';
  sourceRawId?: string;
  createdAt: string;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function buildMonthGrid(year: number, month: number): Date[] {
  // Always render 6 rows × 7 cols = 42 cells. Months that fit in 5 rows show
  // an extra trailing week into the next month — keeps calendar height stable.
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const TrashIcon = () => (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5"
    aria-hidden
  >
    <path d="M2.5 4h9" />
    <path d="M5.5 4V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V4" />
    <path d="M3.5 4l.5 7.5a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9L10.5 4" />
    <path d="M6 6.5v4M8 6.5v4" />
  </svg>
);

export default function Home() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [streamText, setStreamText] = useState('');
  const [streamThinking, setStreamThinking] = useState('');
  const [streamTools, setStreamTools] = useState<{ name: string; input: string }[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [attachments, setAttachments] = useState<{ _id: string; filename: string; size: number; mimeType?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;

  useEffect(() => {
    if (!submitting) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [submitting]);

  // URL params: /?reanalyze=<rawId> or /?continue=<rawId> from knowledge view.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ra = params.get('reanalyze');
    const co = params.get('continue');
    if (ra) {
      fetch(`/api/raw/${ra}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          if (raw?.content !== undefined) {
            setText(raw.content);
            setReanalyzeRawId(ra);
            setLoadedFromRawId(null);
            setContinueRawId(null);
          }
        })
        .catch(() => {});
      window.history.replaceState({}, '', '/');
    } else if (co) {
      setContinueRawId(co);
      setReanalyzeRawId(null);
      setLoadedFromRawId(null);
      window.history.replaceState({}, '', '/');
    }
  }, []);
  const [raws, setRaws] = useState<RawInput[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [inbox, setInbox] = useState<{
    _id: string;
    content: string;
    mode: 'transfer' | 'share';
    sender: { _id: string; name: string; email: string } | null;
    transferredAt: string | null;
  }[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  // When user loads a pending/failed/inbox raw into the main input for editing,
  // we remember its id so we can delete the source after a successful submit.
  const [loadedFromRawId, setLoadedFromRawId] = useState<string | null>(null);
  const [reanalyzeRawId, setReanalyzeRawId] = useState<string | null>(null);
  const [continueRawId, setContinueRawId] = useState<string | null>(null);
  // History navigation: -1 = composing new, 0+ = walking past raws
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loginStep, setLoginStep] = useState<'idle' | 'urlReady' | 'submitting'>('idle');
  const [loginUrl, setLoginUrl] = useState('');
  const [loginSession, setLoginSession] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');
  // Initialize date-dependent state to a stable epoch sentinel on first render,
  // then bump to "today" on client mount. This keeps server HTML and client hydrate
  // outputs identical regardless of timezone differences.
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(2000, 0, 1));
  const [selectedKey, setSelectedKey] = useState<string>('2000-01-01');
  const [popoverStack, setPopoverStack] = useState<string[]>([]);
  const popoverKey = popoverStack[popoverStack.length - 1] ?? null;
  // Avoid SSR/CSR hydration mismatch: any "current time" derived value must
  // resolve only after mount so the server-rendered HTML matches the first
  // client paint regardless of timezone differences.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = new Date();
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
    setSelectedKey(dateKey(t));
    setMounted(true);
  }, []);
  const [showNoDeadline, setShowNoDeadline] = useState(false);
  const [openLineage, setOpenLineage] = useState<string | null>(null);

  async function refresh() {
    const [r, t, a, ib] = await Promise.all([
      fetch('/api/raw').then((r) => r.json()),
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/auth/status').then((r) => r.json()),
      fetch('/api/inbox').then((r) => r.json()),
    ]);
    setRaws(r);
    setAllTasks(t);
    setAuthed(!!a.authenticated);
    setInbox(ib.items ?? []);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      for (const f of arr) fd.append('files', f);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `status ${r.status}`);
      setAttachments((cur) => [...cur, ...data.attachments]);
    } catch (e) {
      setUploadError((e as Error).message ?? String(e));
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(id: string) {
    setAttachments((cur) => cur.filter((a) => a._id !== id));
    fetch(`/api/upload/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function submit(opts?: { content?: string; clearInput?: boolean }) {
    const explicitContent = opts?.content;
    const useText = explicitContent ?? text;
    if (
      (!useText.trim() && attachments.length === 0) ||
      submitting
    ) return;
    setSubmitting(true);
    setSubmitError('');
    setStreamText('');
    setStreamThinking('');
    setStreamTools([]);
    const sentText = useText;
    const sentAttachments = explicitContent ? [] : attachments;
    const cleanupRawId = explicitContent ? null : loadedFromRawId;
    if (opts?.clearInput !== false) {
      if (!explicitContent) setText('');
      setAttachments([]);
      setLoadedFromRawId(null);
      setReanalyzeRawId(null);
      setContinueRawId(null);
      setHistoryIndex(-1);
      setSavedDraft('');
    }

    let res: Response;
    try {
      res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: sentText,
          attachmentIds: sentAttachments.map((a) => a._id),
          reanalyzeRawId: reanalyzeRawId || undefined,
          continueRawId: continueRawId || undefined,
        }),
      });
    } catch (e) {
      console.error('[haera submit] fetch failed', e);
      setSubmitError('서버에 연결하지 못했습니다. 네트워크를 확인해주세요.');
      setSubmitting(false);
      return;
    }

    if (!res.ok || !res.body) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      console.error('[haera submit] bad response', res.status, detail);
      const msg =
        res.status === 401
          ? 'Claude 인증이 필요합니다. 우측 상단 로그인을 진행해주세요.'
          : `서버 응답 오류 (${res.status})${detail ? `: ${detail}` : ''}`;
      setSubmitError(msg);
      setSubmitting(false);
      return;
    }

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          const payload = chunk.slice(6);
          let evt: { type: string; text?: string; name?: string; input?: string; message?: string };
          try {
            evt = JSON.parse(payload);
          } catch (parseErr) {
            console.warn('[haera submit] SSE chunk parse failed:', payload.slice(0, 200), parseErr);
            continue;
          }
          if (evt.type === 'text' && evt.text) {
            setStreamText((s) => s + evt.text);
          } else if (evt.type === 'thinking' && evt.text) {
            setStreamThinking((s) => s + evt.text);
          } else if (evt.type === 'tool' && evt.name) {
            setStreamTools((arr) => [...arr, { name: evt.name!, input: evt.input ?? '' }]);
          } else if (evt.type === 'error') {
            throw new Error(evt.message || '알 수 없는 처리 오류');
          }
        }
      }
      // After a successful run, remove the source raw if the input was loaded
      // from a pending/inbox/failed item.
      if (cleanupRawId) {
        await fetch(`/api/raw/${cleanupRawId}`, { method: 'DELETE' }).catch(() => {});
      }
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[haera submit] stream error', e);
      setSubmitError(`처리 중 오류: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  function loadIntoInput(rawId: string, content: string) {
    setText(content);
    setLoadedFromRawId(rawId);
    setReanalyzeRawId(null);
    setContinueRawId(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function loadForReanalyze(rawId: string, content: string) {
    setText(content);
    setLoadedFromRawId(null);
    setReanalyzeRawId(rawId);
    setContinueRawId(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function loadForContinue(rawId: string) {
    setText('');
    setLoadedFromRawId(null);
    setReanalyzeRawId(null);
    setContinueRawId(rawId);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function startLogin() {
    setLoginError('');
    setLoginUrl('');
    setLoginSession('');
    setLoginStep('urlReady');
    try {
      const r = await fetch('/api/auth/start', { method: 'POST' }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setLoginUrl(r.url);
      setLoginSession(r.id);
    } catch (e) {
      setLoginError(String((e as Error).message ?? e));
      setLoginStep('idle');
    }
  }

  async function submitLoginCode() {
    if (!loginCode.trim() || !loginSession) return;
    setLoginStep('submitting');
    setLoginError('');
    try {
      const r = await fetch('/api/auth/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: loginSession, code: loginCode }),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setLoginCode('');
      setLoginUrl('');
      setLoginSession('');
      setLoginStep('idle');
      refresh();
    } catch (e) {
      setLoginError(String((e as Error).message ?? e));
      setLoginStep('urlReady');
    }
  }

  async function toggleTask(t: Task) {
    await fetch(`/api/tasks/${t._id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: t.status === 'todo' ? 'done' : 'todo' }),
    });
    refresh();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function setTaskDeadline(id: string, dateStr: string) {
    if (!dateStr) return;
    // Default to 18:00 KST on the chosen calendar date.
    const [y, m, d] = dateStr.split('-').map(Number);
    const deadline = new Date(y, m - 1, d, 18, 0, 0);
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deadline: deadline.toISOString() }),
    });
    refresh();
  }

  async function deleteRaw(id: string) {
    await fetch(`/api/raw/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function rejectInbox(id: string) {
    await fetch(`/api/inbox/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function acceptInbox(id: string, content: string) {
    if (acceptingId) return;
    setAcceptingId(id);
    try {
      // Mark accepted first so it leaves the inbox immediately, then process.
      await fetch(`/api/inbox/${id}`, { method: 'PATCH' });
      setInbox((cur) => cur.filter((i) => i._id !== id));
      await submit({ content, clearInput: false });
    } finally {
      setAcceptingId(null);
    }
  }

  const tasksByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.deadline) continue;
      const key = dateKey(new Date(t.deadline));
      const arr = m.get(key) ?? [];
      arr.push(t);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''));
    }
    return m;
  }, [allTasks]);

  const noDeadline = useMemo(
    () => allTasks.filter((t) => !t.deadline && t.status === 'todo'),
    [allTasks],
  );

  // Own raws sorted newest-first, used for ↑↓ history navigation in the input.
  // Excludes incoming items (which live in the 받은 항목 inbox).
  const myRaws = useMemo(
    () =>
      [...raws]
        .filter((r) => !r.transferredFrom)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [raws],
  );

  function historyUp() {
    if (myRaws.length === 0) return;
    if (historyIndex === -1) setSavedDraft(text);
    const next = Math.min(historyIndex + 1, myRaws.length - 1);
    if (next === historyIndex) return;
    const r = myRaws[next];
    setHistoryIndex(next);
    setText(r.content);
    setReanalyzeRawId(r._id);
    setLoadedFromRawId(null);
    setContinueRawId(null);
  }

  function historyDown() {
    if (historyIndex < 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    if (next === -1) {
      setText(savedDraft);
      setReanalyzeRawId(null);
    } else {
      const r = myRaws[next];
      setText(r.content);
      setReanalyzeRawId(r._id);
    }
  }

  const todayKey = mounted ? dateKey(new Date()) : '';
  const nowMs = mounted ? Date.now() : 0;
  const grid = buildMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth());
  const popoverDate = useMemo(() => {
    if (!popoverKey) return null;
    const [y, m, d] = popoverKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [popoverKey]);
  const popoverTasks = popoverKey ? tasksByDay.get(popoverKey) ?? [] : [];

  // "정리 대기" excludes inbox items (those have transferredFrom and are listed separately above).
  const pending = raws.filter((r) => r.status === 'pending' && !r.transferredFrom);
  const failed = raws.filter((r) => r.status === 'failed');

  function gotoMonth(delta: number) {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1));
  }
  function gotoToday() {
    const t = new Date();
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
    setSelectedKey(dateKey(t));
  }

  function handleCellClick(k: string) {
    setSelectedKey(k);
    setPopoverStack((prev) => {
      // Same-cell on a single popover → close. Otherwise reset stack to that cell.
      if (prev.length === 1 && prev[0] === k) return [];
      return [k];
    });
  }

  function popPopover() {
    setPopoverStack((prev) => prev.slice(0, -1));
  }

  function pushPopover(k: string) {
    setPopoverStack((prev) => [...prev, k]);
  }

  // Close all popovers when clicking outside (anything that isn't a calendar cell or any popover).
  useEffect(() => {
    if (popoverStack.length === 0) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest('[data-haera-popover]')) return;
      if (t.closest('[data-haera-cell]')) return;
      setPopoverStack([]);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [popoverStack.length]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      {inbox.length > 0 && (
        <section className="space-y-2 rounded border border-blue-200 bg-blue-50/40 p-3">
          <h2 className="text-sm font-semibold text-blue-900">
            받은 항목 ({inbox.length})
          </h2>
          <p className="text-[11px] text-blue-700/80">
            본문 클릭 → 입력창에 채워짐 (편집 후 분석하기). 또는 "수락"으로 즉시 정리.
          </p>
          <ul className="space-y-2">
            {inbox.map((it) => {
              const senderName = it.sender?.name ?? '알 수 없음';
              const modeLabel = it.mode === 'share' ? '공유' : '전달';
              const modeCls =
                it.mode === 'share'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-blue-100 text-blue-800';
              const isLoaded = loadedFromRawId === it._id;
              return (
                <li
                  key={it._id}
                  className={cls(
                    'rounded border p-3 text-sm transition',
                    isLoaded
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                      : 'border-zinc-200 bg-white',
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className={cls('rounded px-1.5 py-0.5 font-medium', modeCls)}>
                      {modeLabel}
                    </span>
                    <span className="font-medium text-zinc-700">{senderName}</span>
                    {it.transferredAt && <span>{fmtDateTime(it.transferredAt)}</span>}
                    {isLoaded && (
                      <span className="ml-auto text-blue-700">↑ 입력창에 로드됨</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => loadIntoInput(it._id, it.content)}
                    className="block w-full cursor-pointer rounded text-left hover:bg-blue-50/60"
                    title="클릭하면 입력창에 채워집니다"
                  >
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-800">
                      {it.content.length > 500
                        ? it.content.slice(0, 500) + '...'
                        : it.content}
                    </pre>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={!!acceptingId || submitting}
                      onClick={() => acceptInbox(it._id, it.content)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {acceptingId === it._id ? '처리 중...' : '수락 (정리)'}
                    </button>
                    <button
                      disabled={!!acceptingId}
                      onClick={() => rejectInbox(it._id)}
                      className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                    >
                      거절
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-600">
            정리 대기 ({pending.length})
          </h2>
          <p className="text-[11px] text-zinc-500">
            본문 클릭하면 입력창에 채워집니다 — 수정 후 [분석하기] 누르면 처리되고 원본은 자동 삭제.
          </p>
          <ul className="space-y-2">
            {pending.map((r) => {
              const isLoaded = loadedFromRawId === r._id;
              return (
                <li
                  key={r._id}
                  className={cls(
                    'rounded border p-3 text-sm transition',
                    isLoaded
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                      : 'border-zinc-200 bg-zinc-50',
                  )}
                >
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{fmtDateTime(r.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      <TransferButton type="raw" id={r._id} onDone={refresh} />
                      <button
                        disabled={!!acceptingId || submitting}
                        onClick={() => acceptInbox(r._id, r.content)}
                        className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        {acceptingId === r._id ? '...' : '지금 정리'}
                      </button>
                      <button
                        onClick={() => deleteRaw(r._id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="삭제"
                        aria-label="삭제"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  {r.error && (
                    <p className="mt-1 text-xs text-amber-700">사유: {r.error}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => loadIntoInput(r._id, r.content)}
                    className="mt-2 block w-full cursor-pointer rounded text-left hover:bg-blue-50/40"
                    title="클릭하면 입력창에 채워집니다"
                  >
                    <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700">
                      {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                    </pre>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-red-700">
            정리 실패 ({failed.length})
          </h2>
          <p className="text-[11px] text-red-700/70">
            아래 사유 확인 후 본문 클릭 → 입력창에서 수정 → 다시 [분석하기]
          </p>
          <ul className="space-y-2">
            {failed.map((r) => {
              const isLoaded = loadedFromRawId === r._id;
              return (
                <li
                  key={r._id}
                  className={cls(
                    'rounded border p-3 text-sm transition',
                    isLoaded
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                      : 'border-red-300 bg-red-50',
                  )}
                >
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>{fmtDateTime(r.createdAt)}</span>
                    <button
                      onClick={() => deleteRaw(r._id)}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-700"
                      title="삭제"
                      aria-label="삭제"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {r.error ? (
                    <p className="mt-1 rounded bg-red-100 px-2 py-1 text-xs text-red-800">
                      사유: {r.error}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-zinc-500">사유 기록 없음</p>
                  )}
                  <button
                    type="button"
                    onClick={() => loadIntoInput(r._id, r.content)}
                    className="mt-2 block w-full cursor-pointer rounded text-left hover:bg-blue-50/40"
                    title="클릭하면 입력창에 채워집니다"
                  >
                    <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700">
                      {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                    </pre>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {authed === false && (
        <section className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-800">
            Claude 로그인이 필요합니다.
          </div>
          {loginStep === 'idle' && (
            <button
              onClick={startLogin}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
            >
              로그인 시작
            </button>
          )}
          {loginStep !== 'idle' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-amber-800">
                  1. 아래 링크 클릭 → Claude 로그인 → 화면에 표시되는 코드 복사
                </div>
                {loginUrl ? (
                  <a
                    href={loginUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all rounded border border-zinc-200 bg-white p-2 text-xs text-blue-700 underline"
                  >
                    {loginUrl}
                  </a>
                ) : (
                  <div className="text-xs text-zinc-500">URL 받는 중...</div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs text-amber-800">2. 받은 코드 붙여넣기:</div>
                <div className="flex gap-2">
                  <input
                    value={loginCode}
                    onChange={(e) => setLoginCode(e.target.value)}
                    placeholder="브라우저에서 받은 코드"
                    className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
                  />
                  <button
                    disabled={loginStep === 'submitting' || !loginCode.trim() || !loginSession}
                    onClick={submitLoginCode}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {loginStep === 'submitting' ? '확인 중...' : '확인'}
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  setLoginStep('idle');
                  setLoginUrl('');
                  setLoginCode('');
                  setLoginSession('');
                  setLoginError('');
                }}
                className="text-xs text-zinc-500 hover:text-zinc-700"
              >
                취소
              </button>
            </div>
          )}
          {loginError && <div className="text-xs text-red-700">에러: {loginError}</div>}
        </section>
      )}

      <section
        className={cls(
          'relative space-y-2 rounded border-2 border-dashed p-2 transition',
          isDragging
            ? 'border-blue-500 bg-blue-50/70'
            : 'border-transparent',
        )}
        onDragEnter={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            setDragDepth((d) => d + 1);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            setDragDepth((d) => Math.max(0, d - 1));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragDepth(0);
          if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-blue-50/90 text-base font-medium text-blue-700">
            📎 여기 놓으면 첨부됩니다
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <div className="flex flex-col justify-between gap-1">
            <button
              type="button"
              onClick={historyUp}
              disabled={myRaws.length === 0 || historyIndex >= myRaws.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              title="이전 입력 (↑)"
              aria-label="이전 입력"
            >
              ↑
            </button>
            {historyIndex >= 0 && (
              <span className="text-center text-[10px] text-zinc-500">
                {historyIndex + 1}/{myRaws.length}
              </span>
            )}
            <button
              type="button"
              onClick={historyDown}
              disabled={historyIndex < 0}
              className="flex h-8 w-8 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              title="다음 입력 (↓) / 작성 중인 입력으로"
              aria-label="다음 입력"
            >
              ↓
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
                return;
              }
              // ↑↓ for history when meta/ctrl held (avoids conflict with cursor movement)
              if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
                e.preventDefault();
                historyUp();
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
                e.preventDefault();
                historyDown();
              }
            }}
            placeholder="내용 붙여넣기 / 질문 / 명령 / 파일 드래그 — Enter로 분석, Shift+Enter 줄바꿈, Ctrl+↑↓로 이전 입력 탐색"
            rows={4}
            className="flex-1 resize-y rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
          />
          <button
            disabled={submitting || (!text.trim() && attachments.length === 0) || authed === false}
            onClick={() => submit()}
            className="rounded bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? '처리 중...' : '분석하기'}
          </button>
          <SendToOthersButton
            text={text}
            disabled={submitting}
            onSent={({ mode }) => {
              const sentText = text;
              if (mode === 'share') {
                // Also process locally so sender's workspace gets the same content.
                submit();
              } else {
                setText('');
                setAttachments([]);
              }
              // Suppress unused-var lint
              void sentText;
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="cursor-pointer rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-700 hover:bg-zinc-100">
            📎 파일 첨부
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {uploading && <span className="text-zinc-500">업로드 중...</span>}
          {uploadError && <span className="text-red-700">업로드 실패: {uploadError}</span>}
          {attachments.map((a) => (
            <span
              key={a._id}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-blue-800"
            >
              📎 {a.filename}
              <span className="text-blue-500">({Math.round(a.size / 1024)}KB)</span>
              <button
                onClick={() => removeAttachment(a._id)}
                className="text-blue-500 hover:text-red-600"
                aria-label="첨부 삭제"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        {loadedFromRawId && (
          <div className="text-xs text-blue-700">
            대기/실패 항목에서 로드됨 — 분석하기 후 원본 자동 삭제됩니다.{' '}
            <button
              type="button"
              onClick={() => {
                setText('');
                setLoadedFromRawId(null);
              }}
              className="underline hover:text-blue-900"
            >
              취소
            </button>
          </div>
        )}
        {reanalyzeRawId && (
          <div className="text-xs text-amber-700">
            ↻ 재분석 모드 — 분석하기 누르면 이 raw의 본문이 갱신되고 기존 산출물(task/note)은 휴지통으로.{' '}
            <button
              type="button"
              onClick={() => {
                setText('');
                setReanalyzeRawId(null);
              }}
              className="underline hover:text-amber-900"
            >
              취소
            </button>
          </div>
        )}
        {continueRawId && (
          <div className="text-xs text-emerald-700">
            ↩ 이어서 답변 모드 — 이전 대화 컨텍스트와 함께 처리됩니다.{' '}
            <button
              type="button"
              onClick={() => {
                setText('');
                setContinueRawId(null);
              }}
              className="underline hover:text-emerald-900"
            >
              취소
            </button>
          </div>
        )}
        {submitError && (
          <pre className="whitespace-pre-wrap break-words rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
            {submitError}
          </pre>
        )}
        {(submitting || streamText || streamTools.length > 0 || streamThinking) && (
          <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
            {submitting && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
                <span>{streamText ? '응답 중' : streamThinking ? '깊이 생각 중' : '연결 중'}... ({elapsed}초)</span>
              </div>
            )}
            {streamTools.length > 0 && (
              <ul className="space-y-1 text-[11px] text-zinc-500">
                {streamTools.map((t, i) => (
                  <li key={i} className="truncate">
                    🔧 <span className="font-medium">{t.name}</span>{' '}
                    <span className="text-zinc-400">{t.input}</span>
                  </li>
                ))}
              </ul>
            )}
            {streamThinking && (
              <details
                open={showThinking}
                onToggle={(e) => setShowThinking((e.target as HTMLDetailsElement).open)}
                className="text-xs text-zinc-500"
              >
                <summary className="cursor-pointer hover:text-zinc-800">
                  생각 ({streamThinking.length}자)
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-zinc-500">
                  {streamThinking}
                </pre>
              </details>
            )}
            {streamText && (
              <pre className="whitespace-pre-wrap break-words font-sans text-zinc-800">
                {streamText}
              </pre>
            )}
            {!submitting && (streamText || streamTools.length > 0) && (
              <button
                onClick={() => {
                  setStreamText('');
                  setStreamThinking('');
                  setStreamTools([]);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-800"
              >
                지우기
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => gotoMonth(-1)}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100"
          >
            ◀
          </button>
          <h2 className="min-w-[10ch] text-center text-lg font-semibold">
            {viewMonth.getFullYear()}년 {viewMonth.getMonth() + 1}월
          </h2>
          <button
            onClick={() => gotoMonth(1)}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100"
          >
            ▶
          </button>
          <button
            onClick={gotoToday}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100"
          >
            오늘
          </button>
        </div>

        <div className="relative grid grid-cols-7 rounded border border-zinc-200 bg-white text-sm">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={cls(
                'border-b border-zinc-200 bg-zinc-50 px-2 py-1 text-center text-xs font-medium text-zinc-700',
                i === 0 && 'text-red-600',
                i === 6 && 'text-blue-600',
              )}
            >
              {w}
            </div>
          ))}
          {grid.map((d, i) => {
            const k = dateKey(d);
            const isOtherMonth = d.getMonth() !== viewMonth.getMonth();
            const isToday = k === todayKey;
            const isSelected = k === selectedKey;
            const dayTasks = tasksByDay.get(k) ?? [];
            const dow = d.getDay();
            return (
              <button
                key={i}
                data-haera-cell
                onClick={() => handleCellClick(k)}
                className={cls(
                  'flex min-h-[100px] flex-col items-stretch border-b border-r border-zinc-200 p-1 text-left transition hover:bg-zinc-50',
                  i % 7 === 6 && 'border-r-0',
                  i >= grid.length - 7 && 'border-b-0',
                  isOtherMonth && 'bg-zinc-50 text-zinc-400',
                  isSelected && 'bg-blue-50',
                  isToday && 'ring-1 ring-inset ring-blue-500',
                )}
              >
                <div
                  className={cls(
                    'text-xs',
                    !isOtherMonth && dow === 0 && 'text-red-600',
                    !isOtherMonth && dow === 6 && 'text-blue-600',
                  )}
                >
                  {d.getDate()}
                </div>
                <div className="mt-1 space-y-0.5">
                  {dayTasks.slice(0, 3).map((t) => {
                    const overdue =
                      t.status === 'todo' &&
                      t.deadline &&
                      new Date(t.deadline).getTime() < nowMs;
                    return (
                      <div
                        key={t._id}
                        className={cls(
                          'truncate rounded px-1 text-[11px] leading-tight',
                          t.status === 'done' && 'text-zinc-400 line-through',
                          t.status === 'todo' && overdue && 'bg-red-100 text-red-800',
                          t.status === 'todo' && !overdue && 'bg-blue-100 text-blue-800',
                        )}
                      >
                        {t.title}
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="px-1 text-[10px] text-zinc-500">
                      +{dayTasks.length - 3}건 더
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          {popoverStack.map((stackKey, stackIdx) => {
            const depth = popoverStack.length - 1 - stackIdx;
            const isTop = depth === 0;
            const [py, pm, pd] = stackKey.split('-').map(Number);
            const stackDate = new Date(py, pm - 1, pd);
            const stackTasks = tasksByDay.get(stackKey) ?? [];
            const offset = depth * 14;
            return (
              <div
                key={`${stackKey}-${stackIdx}`}
                data-haera-popover
                onMouseDown={(e) => {
                  if (!isTop) {
                    e.stopPropagation();
                    // Bring this layer to top by popping everything above it.
                    setPopoverStack((prev) => prev.slice(0, stackIdx + 1));
                  }
                }}
                className={cls(
                  'absolute left-1/2 top-1/2 w-80 max-w-[calc(100%-2rem)] rounded-md border border-zinc-300 bg-white shadow-xl transition',
                  !isTop && 'cursor-pointer',
                )}
                style={{
                  transform: `translate(calc(-50% - ${offset}px), calc(-50% - ${offset}px))`,
                  zIndex: 40 + stackIdx,
                  opacity: isTop ? 1 : Math.max(0.4, 0.85 - depth * 0.18),
                }}
              >
              <div className={cls(!isTop && 'pointer-events-none')}>
                <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                  <h3 className="text-sm font-semibold">
                    {fmtFullDate(stackDate)}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {stackTasks.length}건
                    </span>
                  </h3>
                  <button
                    onClick={popPopover}
                    className="text-zinc-400 hover:text-zinc-700"
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto p-3">
                  {stackTasks.length === 0 ? (
                    <p className="text-sm text-zinc-400">할 일 없음</p>
                  ) : (
                    <ul className="space-y-2">
                      {stackTasks.map((t) => {
                        const overdue =
                          t.status === 'todo' &&
                          t.deadline &&
                          new Date(t.deadline).getTime() < nowMs;
                        return (
                          <li
                            key={t._id}
                            className={cls(
                              'flex gap-2 rounded border p-2',
                              t.status === 'done'
                                ? 'border-zinc-200 bg-zinc-50'
                                : overdue
                                  ? 'border-red-300 bg-red-50'
                                  : 'border-zinc-200 bg-white',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={t.status === 'done'}
                              onChange={() => toggleTask(t)}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenLineage((prev) => (prev === t._id ? null : t._id));
                                  }}
                                  className={cls(
                                    'text-left text-sm font-medium hover:text-blue-700',
                                    t.status === 'done' && 'text-zinc-400 line-through',
                                  )}
                                  title="클릭하면 출처 보기"
                                >
                                  {t.title}
                                </button>
                                {t.deadline && (
                                  <span className="text-xs text-zinc-500">
                                    {fmtDateTime(t.deadline)}
                                  </span>
                                )}
                                {t.priority === 'high' && t.status === 'todo' && (
                                  <span className="rounded bg-red-100 px-1.5 text-[10px] text-red-800">
                                    우선
                                  </span>
                                )}
                              </div>
                              {t.description && (
                                <p
                                  className={cls(
                                    'mt-1 text-xs',
                                    t.status === 'done' ? 'text-zinc-400' : 'text-zinc-600',
                                  )}
                                >
                                  {t.description}
                                </p>
                              )}
                              {openLineage === t._id && (
                                <LineagePanel
                                  type="task"
                                  id={t._id}
                                  onSelectSibling={(f) => {
                                    if (f.type === 'task' && f.deadline) {
                                      const d = new Date(f.deadline);
                                      const k = dateKey(d);
                                      setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                                      setSelectedKey(k);
                                      pushPopover(k);
                                      setOpenLineage(f._id);
                                      return true;
                                    }
                                    if (f.type === 'task' && !f.deadline) {
                                      setOpenLineage(f._id);
                                      setShowNoDeadline(true);
                                      setPopoverStack([]);
                                      return true;
                                    }
                                    // notes have no calendar position; let panel expand inline
                                    return false;
                                  }}
                                />
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <TransferButton
                                type="task"
                                id={t._id}
                                onDone={refresh}
                              />
                              <button
                                onClick={() => deleteTask(t._id)}
                                className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
                                title="삭제"
                                aria-label="삭제"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </section>

      {noDeadline.length > 0 && (
        <section className="space-y-2">
          <button
            onClick={() => setShowNoDeadline((v) => !v)}
            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            {showNoDeadline ? '▼' : '▶'} 기한 없음 ({noDeadline.length})
          </button>
          {showNoDeadline && (
            <ul className="space-y-2">
              {noDeadline.map((t) => (
                <li
                  key={t._id}
                  className="flex gap-2 rounded border border-zinc-200 bg-white p-2"
                >
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    onChange={() => toggleTask(t)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{t.title}</span>
                    {t.description && (
                      <p className="mt-1 text-xs text-zinc-600">{t.description}</p>
                    )}
                  </div>
                  <input
                    type="date"
                    onChange={(e) => setTaskDeadline(t._id, e.target.value)}
                    className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-700"
                    title="마감일 설정"
                  />
                  <button
                    onClick={() => deleteTask(t._id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
                    title="삭제"
                    aria-label="삭제"
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

    </main>
  );
}
