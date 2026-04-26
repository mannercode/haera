import { NextRequest } from 'next/server';
import { spawn } from 'node:child_process';
import { ObjectId } from 'mongodb';
import { getDb, Note, Task, Attachment } from '@/lib/mongodb';
import { getClaudeToken } from '@/lib/claude';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const attachmentIds = Array.isArray(body?.attachmentIds)
    ? (body.attachmentIds as unknown[]).filter(
        (x): x is string => typeof x === 'string' && ObjectId.isValid(x),
      )
    : [];
  if (!text && attachmentIds.length === 0) {
    return new Response('text or attachments required', { status: 400 });
  }

  const token = await getClaudeToken();
  if (!token) return new Response('Claude not authenticated', { status: 401 });

  const db = await getDb();
  const [notes, tasks, attachments] = await Promise.all([
    db.collection<Note>('notes').find({}).sort({ createdAt: -1 }).limit(300).toArray(),
    db
      .collection<Task>('tasks')
      .find({ status: 'todo' })
      .sort({ deadline: 1 })
      .limit(200)
      .toArray(),
    attachmentIds.length > 0
      ? db
          .collection<Attachment>('attachments')
          .find({ _id: { $in: attachmentIds.map((s) => new ObjectId(s) as unknown as string) } })
          .toArray()
      : Promise.resolve([] as Attachment[]),
  ]);

  const now = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const notesBlock = notes.length
    ? notes
        .map((n) => {
          const tags = n.tags?.length ? ` [${n.tags.join(', ')}]` : '';
          return `- _id=${n._id} · ${n.title}${tags}\n  ${n.content.replace(/\n/g, '\n  ')}`;
        })
        .join('\n')
    : '(없음)';

  const tasksBlock = tasks.length
    ? tasks
        .map((t) => {
          const d = t.deadline
            ? new Date(t.deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            : '기한 없음';
          const desc = t.description ? ` — ${t.description}` : '';
          return `- _id=${t._id} · ${t.title} (마감: ${d})${desc}`;
        })
        .join('\n')
    : '(없음)';

  const prompt = `너는 haera 어시스턴트다.
사용자가 입력한 텍스트의 성격을 판단해서 처리하고, 한국어로 1~3줄 결과만 보고해라.

현재 시각: ${now}
API 베이스: http://localhost:3000

## 처리 분기
1. **새로운 내용** (이메일/메신저 본문, 회의록, 정보 모음) → 할 일/노트로 분해해서 직접 저장. 마감일은 ISO8601 KST. 노트의 민감정보(비밀번호 등)는 그대로 저장.
2. **질문** → 컨텍스트 보고 답변. 모르면 솔직히.
3. **수정/추가/삭제 명령** → _id 찾아서 PATCH/POST/DELETE 호출, 결과 보고.
4. **URL/링크** (단독 입력이든, 본문 안에 섞여 있든):
   - 입력에 URL이 있으면 **반드시 즐겨찾기로 저장**한다. URL은 빠뜨리지 말고 모두 저장.
   - **단일 URL 또는 소수(<10개)**: 각 URL마다 별도의 노트 생성. WebFetch로 페이지 제목/요약 가져오기.
     - title = 페이지 실제 제목 (짧고 명확)
     - content = 한두 문장 요약 + 원본 URL (URL은 반드시 content에 포함, 즐겨찾기 모달이 거기서 추출함)
     - tags = 주제 카테고리 1~3개 (예: ["개발", "MongoDB"], ["뉴스", "경제"], ["DIY"])
   - **다수의 URL이 본문 일부로 섞여 있는 경우**: URL은 별도 노트들로 빼고, 나머지 본문(액션/메모)은 따로 task/note로 처리.
   - **벌크 임포트(브라우저 북마크 파일 등 수십~수백 개)**: 카테고리별로 묶어서 1개 노트당 여러 URL을 content에 줄 단위로 정리. 즐겨찾기 모달이 줄별로 추출함.
5. **혼합** → 각각 처리.
6. **잘 모르겠으면** → POST /api/raw 로 저장 (cron 처리).

## API
- GET/POST/PATCH/DELETE /api/tasks[/<id>]
- GET/POST/PATCH/DELETE /api/notes[/<id>]
- POST /api/raw

마감 상대표현(오늘/내일/하루 미뤄/이번주 금요일)은 현재 시각 기준 환산.

## 컨텍스트
[참고정보 ${notes.length}건]
${notesBlock}

[진행 중인 할 일 ${tasks.length}건]
${tasksBlock}

${attachments.length > 0
  ? `## 첨부 파일 — 반드시 Read 도구로 모두 열어보고 내용을 파악해라
${attachments.map((a) => `- 경로: ${a.storagePath}\n  원본 이름: ${a.filename}\n  타입: ${a.mimeType ?? 'unknown'} (${a.size} bytes)`).join('\n')}

위 파일들은 사용자가 첨부한 자료다. Read 도구로 각 파일을 열어서 내용을 본 다음, 사용자 입력과 함께 종합해서 처리해라.

`
  : ''}## 사용자 입력
${text || '(첨부만 있고 텍스트 없음)'}

## 출력 규칙
- 사고 과정 출력 금지. 한국어 1~3줄 결과만.
- 절대 회피하지 말 것 — 도구 있으면 직접 실행.
${attachments.length > 0 ? '- 첨부 파일 내용은 Read 도구로 읽어서 본문/이미지 모두 분석해라.' : ''}`;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      const proc = spawn(
        'claude',
        [
          '--print',
          '--model', 'claude-opus-4-7',
          '--effort', 'max',
          '--output-format', 'stream-json',
          '--include-partial-messages',
          '--verbose',
          '--allowedTools', 'Bash,Read,WebFetch,WebSearch',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CLAUDE_CODE_OAUTH_TOKEN: token,
            TERM: 'dumb',
            NO_COLOR: '1',
          },
        },
      );

      let lineBuf = '';
      let stderrBuf = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        lineBuf += chunk.toString('utf8');
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let obj: any;
          try {
            obj = JSON.parse(t);
          } catch {
            continue;
          }
          // Partial message deltas (text + thinking)
          if (obj.type === 'stream_event' && obj.event) {
            const ev = obj.event;
            if (ev.type === 'content_block_delta' && ev.delta) {
              if (ev.delta.type === 'text_delta' && ev.delta.text) {
                send({ type: 'text', text: ev.delta.text });
              } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
                send({ type: 'thinking', text: ev.delta.thinking });
              }
            }
          }
          // Tool use blocks (full message events, not deltas)
          else if (obj.type === 'assistant' && obj.message?.content) {
            for (const c of obj.message.content) {
              if (c.type === 'tool_use') {
                const inputPreview = JSON.stringify(c.input ?? {}).slice(0, 300);
                send({ type: 'tool', name: c.name, input: inputPreview });
              }
            }
          }
          // Final result wrapper
          else if (obj.type === 'result' && obj.is_error) {
            send({ type: 'error', message: obj.result || 'unknown error' });
          }
        }
      });

      proc.stderr.on('data', (d: Buffer) => {
        stderrBuf += d.toString('utf8');
      });

      proc.on('error', (e) => {
        send({ type: 'error', message: e.message });
        try { controller.close(); } catch {}
      });

      proc.on('exit', (code) => {
        if (code !== 0 && stderrBuf) {
          send({ type: 'error', message: stderrBuf.slice(-300) });
        }
        send({ type: 'done' });
        try { controller.close(); } catch {}
      });

      proc.stdin.end(prompt);
    },
    cancel() {
      // No-op; child process cleanup happens in exit handler
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
