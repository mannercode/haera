import { MongoClient, Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var _mongoConnected: boolean | undefined;
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? 'haera';
  if (!uri) throw new Error('MONGODB_URI is not set');

  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri);
  }
  if (!global._mongoConnected) {
    await global._mongoClient.connect();
    global._mongoConnected = true;
  }
  return global._mongoClient.db(dbName);
}

export type RawStatus = 'pending' | 'processed' | 'failed';

export interface RawInput {
  _id?: string;
  ownerId?: string;
  content: string;
  source?: string;
  instructions?: string;
  createdAt: Date;
  status: RawStatus;
  processedAt?: Date;
  error?: string;
  transferredFrom?: string;
  transferredAt?: Date;
  transferMode?: 'transfer' | 'share';
  // Claude의 최종 응답 텍스트 (질문에 대한 답변, 처리 결과 보고 등). 스트리밍 종료 후 저장.
  response?: string;
}

export type TaskStatus = 'todo' | 'done';

export interface Task {
  _id?: string;
  ownerId?: string;
  title: string;
  deadline?: Date | null;
  description?: string;
  sourceRawId?: string;        // legacy single source (still read for backward compat)
  sourceRawIds?: string[];     // multiple sources — preferred
  priority?: 'low' | 'normal' | 'high';
  status: TaskStatus;
  createdAt: Date;
  transferredFrom?: string;
  transferredAt?: Date;
  transferMode?: 'transfer' | 'share';
}

export interface Note {
  _id?: string;
  ownerId?: string;
  title: string;
  content: string;
  tags?: string[];
  sourceRawId?: string;        // legacy single source
  sourceRawIds?: string[];     // multiple sources
  createdAt: Date;
  transferredFrom?: string;
  transferredAt?: Date;
  transferMode?: 'transfer' | 'share';
}

export type TrashKind = 'task' | 'note' | 'raw' | 'attachment';

export interface TrashItem {
  _id?: string;
  ownerId: string;
  kind: TrashKind;
  originalId: string;
  payload: Record<string, unknown>;
  deletedAt: Date;
}

export type TransferType = 'task' | 'note' | 'raw' | 'send';
export type TransferMode = 'transfer' | 'share';

export interface Transfer {
  _id?: string;
  fromUserId: string;
  toUserId: string;
  type: TransferType;
  mode: TransferMode;
  sourceItemId?: string;     // original doc id on sender side (null for /api/send)
  targetItemId: string;      // resulting doc id on recipient side
  title?: string;            // snapshot of title at time of transfer
  contentSnippet?: string;   // first 200 chars of content
  at: Date;
}

export function getSourceRawIds(doc: { sourceRawId?: string; sourceRawIds?: string[] }): string[] {
  const set = new Set<string>();
  if (doc.sourceRawIds) {
    for (const id of doc.sourceRawIds) if (id) set.add(id);
  }
  if (doc.sourceRawId) set.add(doc.sourceRawId);
  return Array.from(set);
}

export interface Attachment {
  _id?: string;
  ownerId?: string;
  filename: string;       // original filename (sanitized for display)
  storagePath: string;    // S3 object key (or legacy /var/... path)
  size: number;
  mimeType?: string;
  createdAt: Date;
}

export interface BookmarkClick {
  _id: string;            // the URL itself
  count: number;
  lastAt: Date;
  ownerId?: string;
}

export interface User {
  _id?: string;
  email: string;
  passwordHash: string;
  name: string;
  isAdmin?: boolean;
  createdAt: Date;
}
