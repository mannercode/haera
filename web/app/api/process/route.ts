import { NextRequest } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ObjectId } from 'mongodb';
import { getDb, Note, Task, Attachment, RawInput } from '@/lib/mongodb';
import { getClaudeToken } from '@/lib/claude';
import { getObjectBuffer, isLegacyLocalPath } from '@/lib/storage';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const ownerOrResp = await requireOwner(req);
  if (isAuthResponse(ownerOrResp)) return ownerOrResp;
  const owner = ownerOrResp;
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
    db
      .collection<Note>('notes')
      .find({ ownerId: owner })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray(),
    db
      .collection<Task>('tasks')
      .find({ ownerId: owner, status: 'todo' })
      .sort({ deadline: 1 })
      .limit(200)
      .toArray(),
    attachmentIds.length > 0
      ? db
          .collection<Attachment>('attachments')
          .find({
            _id: { $in: attachmentIds.map((s) => new ObjectId(s) as unknown as string) },
            ownerId: owner,
          })
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

  // Materialize S3 attachments to a temp dir so Claude's Read tool can open them.
  // Legacy local paths pass through unchanged. Cleanup happens after the stream ends.
  let tempDir: string | null = null;
  const localPathById = new Map<string, string>();
  if (attachments.length > 0) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'haera-attach-'));
    await Promise.all(
      attachments.map(async (a) => {
        const filename = `${String(a._id)}__${a.filename}`;
        const localPath = path.join(tempDir!, filename);
        const buf = isLegacyLocalPath(a.storagePath)
          ? await readFile(a.storagePath)
          : await getObjectBuffer(a.storagePath);
        await writeFile(localPath, buf);
        localPathById.set(String(a._id), localPath);
      }),
    );
  }

  // Persist the user's input as a raw_input upfront so it shows in 기록 → 원본
  // and tasks/notes Claude creates can reference it via sourceRawIds.
  const rawInsert = await db.collection<RawInput>('raw_inputs').insertOne({
    ownerId: owner,
    content:
      text ||
      (attachments.length > 0
        ? `(첨부 ${attachments.length}개: ${attachments.map((a) => a.filename).join(', ')})`
        : ''),
    createdAt: new Date(),
    status: 'processed',
    processedAt: new Date(),
  });
  const userRawId = String(rawInsert.insertedId);

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

**중요**: 모든 curl 요청에 다음 두 헤더를 반드시 포함해야 한다 (사용자 인증):
\`-H "X-Haera-Internal-Token: $HAERA_INTERNAL_TOKEN" -H "X-Haera-Owner-Id: $HAERA_OWNER_ID"\`
이 환경변수들은 너에게 미리 주입되어 있다. 헤더 없이 호출하면 401 unauthenticated가 떨어진다.

마감 상대표현(오늘/내일/하루 미뤄/이번주 금요일)은 현재 시각 기준 환산.

## 출처 추적 (중요)
- 사용자가 방금 입력한 본문은 **raw_id="${userRawId}"** 로 이미 저장되어 있다.
- 새로 만드는 모든 task/note에는 반드시 \`sourceRawIds: ["${userRawId}"]\` 를 포함해라. (사용자가 "이 task 왜 만들어졌지?" 추적할 수 있어야 함)
- 입력이 **기존 task의 보완·구체화**인 경우: 새 task 만들지 말고 **PATCH /api/tasks/<id> body \`{addSourceRawIds:["${userRawId}"], ...변경필드}\`** 로 출처 누적 + 필드 갱신.
- 노트도 동일하게 \`addSourceRawIds\` 로 출처 누적 가능.

## 컨텍스트
[참고정보 ${notes.length}건]
${notesBlock}

[진행 중인 할 일 ${tasks.length}건]
${tasksBlock}

${attachments.length > 0
  ? `## 첨부 파일 — 반드시 Read 도구로 모두 열어보고 내용을 파악해라
${attachments.map((a) => `- 경로: ${localPathById.get(String(a._id)) ?? a.storagePath}\n  원본 이름: ${a.filename}\n  타입: ${a.mimeType ?? 'unknown'} (${a.size} bytes)`).join('\n')}

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
            HAERA_INTERNAL_TOKEN: process.env.HAERA_INTERNAL_TOKEN ?? '',
            HAERA_OWNER_ID: owner,
          },
        },
      );

      let lineBuf = '';
      let stderrBuf = '';
      // Accumulate Claude's text response so we can persist it on the raw_input.
      let answerText = '';

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
                answerText += ev.delta.text;
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
        if (tempDir) {
          rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      });

      proc.on('exit', (code) => {
        if (code !== 0 && stderrBuf) {
          send({ type: 'error', message: stderrBuf.slice(-300) });
        }
        send({ type: 'done' });
        try { controller.close(); } catch {}
        if (tempDir) {
          rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
        // Persist Claude's response on the raw_input (best-effort, non-blocking).
        if (answerText.trim()) {
          db.collection<RawInput>('raw_inputs')
            .updateOne(
              { _id: rawInsert.insertedId },
              { $set: { response: answerText.trim() } },
            )
            .catch((e) => {
              console.error('[process] failed to save response:', e);
            });
        }
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
