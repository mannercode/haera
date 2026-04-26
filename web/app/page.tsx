'use client';

import { useEffect, useMemo, useState } from 'react';

type RawInput = {
  _id: string;
  content: string;
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
  processedAt?: string;
  error?: string;
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
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((startOffset + daysInMonth) / 7);
  const cellCount = rows * 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: cellCount }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

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
  const [raws, setRaws] = useState<RawInput[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loginStep, setLoginStep] = useState<'idle' | 'urlReady' | 'submitting'>('idle');
  const [loginUrl, setLoginUrl] = useState('');
  const [loginSession, setLoginSession] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selectedKey, setSelectedKey] = useState<string>(() => dateKey(new Date()));
  const [popoverKey, setPopoverKey] = useState<string | null>(null);
  const [showNoDeadline, setShowNoDeadline] = useState(false);

  async function refresh() {
    const [r, t, a] = await Promise.all([
      fetch('/api/raw').then((r) => r.json()),
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/auth/status').then((r) => r.json()),
    ]);
    setRaws(r);
    setAllTasks(t);
    setAuthed(!!a.authenticated);
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

  async function submit() {
    if ((!text.trim() && attachments.length === 0) || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    setStreamText('');
    setStreamThinking('');
    setStreamTools([]);
    const sentText = text;
    const sentAttachments = attachments;
    setText('');
    setAttachments([]);

    let res: Response;
    try {
      res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: sentText,
          attachmentIds: sentAttachments.map((a) => a._id),
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
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[haera submit] stream error', e);
      setSubmitError(`처리 중 오류: ${msg}`);
    } finally {
      setSubmitting(false);
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

  async function deleteRaw(id: string) {
    await fetch(`/api/raw/${id}`, { method: 'DELETE' });
    refresh();
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

  const todayKey = dateKey(new Date());
  const grid = buildMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth());
  const popoverDate = useMemo(() => {
    if (!popoverKey) return null;
    const [y, m, d] = popoverKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [popoverKey]);
  const popoverTasks = popoverKey ? tasksByDay.get(popoverKey) ?? [] : [];

  const pending = raws.filter((r) => r.status === 'pending');
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
    setPopoverKey((prev) => (prev === k ? null : k));
  }

  // Close popover when clicking outside (anything that isn't a calendar cell or the popover itself).
  useEffect(() => {
    if (!popoverKey) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest('[data-haera-popover]')) return;
      if (t.closest('[data-haera-cell]')) return;
      setPopoverKey(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [popoverKey]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
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
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="내용 붙여넣기 / 질문 / 명령 / 파일 드래그 — Enter 전송, Shift+Enter 줄바꿈"
            rows={4}
            className="flex-1 resize-y rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
          />
          <button
            disabled={submitting || (!text.trim() && attachments.length === 0) || authed === false}
            onClick={submit}
            className="rounded bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? '처리 중...' : '보내기'}
          </button>
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
        {pending.length > 0 && (
          <div className="text-xs text-zinc-500">정리 대기: {pending.length}건</div>
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
                      new Date(t.deadline).getTime() < Date.now();
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

          {popoverKey && popoverDate && (
            <div
              data-haera-popover
              className="absolute left-1/2 top-1/2 z-40 w-80 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-zinc-300 bg-white shadow-xl"
            >
                <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                  <h3 className="text-sm font-semibold">
                    {fmtFullDate(popoverDate)}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {popoverTasks.length}건
                    </span>
                  </h3>
                  <button
                    onClick={() => setPopoverKey(null)}
                    className="text-zinc-400 hover:text-zinc-700"
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto p-3">
                  {popoverTasks.length === 0 ? (
                    <p className="text-sm text-zinc-400">할 일 없음</p>
                  ) : (
                    <ul className="space-y-2">
                      {popoverTasks.map((t) => {
                        const overdue =
                          t.status === 'todo' &&
                          t.deadline &&
                          new Date(t.deadline).getTime() < Date.now();
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
                                <span
                                  className={cls(
                                    'text-sm font-medium',
                                    t.status === 'done' && 'text-zinc-400 line-through',
                                  )}
                                >
                                  {t.title}
                                </span>
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
                            </div>
                            <button
                              onClick={() => deleteTask(t._id)}
                              className="self-start text-xs text-zinc-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
              </div>
            </div>
          )}
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
                  <button
                    onClick={() => deleteTask(t._id)}
                    className="self-start text-xs text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-600">
            정리 대기 ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r._id}
                className="rounded border border-zinc-200 bg-zinc-50 p-3 text-sm"
              >
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{fmtDateTime(r.createdAt)}</span>
                  <button
                    onClick={() => deleteRaw(r._id)}
                    className="hover:text-red-600"
                  >
                    삭제
                  </button>
                </div>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
                  {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-red-700">
            정리 실패 ({failed.length})
          </h2>
          <ul className="space-y-2">
            {failed.map((r) => (
              <li
                key={r._id}
                className="rounded border border-red-300 bg-red-50 p-3 text-sm"
              >
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{fmtDateTime(r.createdAt)}</span>
                  <button
                    onClick={() => deleteRaw(r._id)}
                    className="hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
                {r.error && <p className="mt-1 text-xs text-red-700">{r.error}</p>}
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
                  {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
