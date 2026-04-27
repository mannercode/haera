import { NextRequest, NextResponse } from 'next/server';
import { getDb, Note, BookmarkClick } from '@/lib/mongodb';
import { requireOwner, isAuthResponse } from '@/lib/owner';

export const dynamic = 'force-dynamic';

const URL_RE = /https?:\/\/[^\s)\]'"<>]+/gi;

function trimOrphanBrackets(s: string, open: string, close: string): string {
  let depth = 0;
  let firstOrphan = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === open) {
      if (depth === 0) firstOrphan = i;
      depth++;
    } else if (s[i] === close) {
      if (depth > 0) {
        depth--;
        if (depth === 0) firstOrphan = -1;
      }
    }
  }
  if (depth > 0 && firstOrphan >= 0) {
    return s.slice(0, firstOrphan).trimEnd();
  }
  return s;
}

function cleanTitle(rawLine: string, url: string): string {
  let t = rawLine.replace(url, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s\-•*·▶►#–—»>]+/, '').trim();
  t = t.replace(/[\s:：,;|]+$/, '').trim();
  t = trimOrphanBrackets(t, '(', ')');
  t = trimOrphanBrackets(t, '[', ']');
  t = t.replace(/^\s*[)\]]\s*/, '');
  return t.trim();
}

function folderName(noteTitle: string): string {
  // Strip common prefixes like "즐겨찾기 - X", "북마크 - X", "Bookmarks - X".
  return noteTitle
    .replace(/^(즐겨찾기|북마크|bookmarks?)\s*[\-–—:|]+\s*/i, '')
    .trim() || noteTitle;
}

type Bookmark = {
  _id: string;
  title: string;
  url: string;
  folder: string;
  source: string;
  tags?: string[];
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
};

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (isAuthResponse(owner)) return owner;
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '500', 10) || 500),
  );
  const db = await getDb();

  const notesP = db
    .collection<Note>('notes')
    .find({ ownerId: owner, content: { $regex: 'https?://', $options: 'i' } })
    .sort({ createdAt: -1 })
    .toArray();
  const clicksP = db
    .collection<BookmarkClick>('bookmark_clicks')
    .find({ ownerId: owner })
    .toArray();
  const [docs, clickDocs] = await Promise.all([notesP, clicksP]);

  const clicksByUrl = new Map<string, BookmarkClick>();
  for (const c of clickDocs) {
    // _id is `${ownerId}::${url}`; extract the URL part
    const idx = c._id.indexOf('::');
    const url = idx >= 0 ? c._id.slice(idx + 2) : c._id;
    clicksByUrl.set(url, c);
  }

  const out: Bookmark[] = [];
  const seen = new Set<string>();

  for (const note of docs) {
    const noteCreated =
      note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt);
    const folder = folderName(note.title);
    const lines = note.content.split('\n');
    let urlIdx = 0;
    for (const rawLine of lines) {
      const matches = rawLine.match(URL_RE);
      if (!matches) continue;
      for (const url of matches) {
        if (seen.has(url)) continue;
        seen.add(url);
        let title = cleanTitle(rawLine, url);
        if (!title) {
          try {
            title = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            title = url;
          }
        }
        const click = clicksByUrl.get(url);
        out.push({
          _id: `${note._id}#${urlIdx++}`,
          title,
          url,
          folder,
          source: note.title,
          tags: note.tags,
          clickCount: click?.count ?? 0,
          lastClickedAt: click?.lastAt
            ? (click.lastAt instanceof Date ? click.lastAt : new Date(click.lastAt)).toISOString()
            : null,
          createdAt: noteCreated.toISOString(),
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }

  return NextResponse.json(out);
}
