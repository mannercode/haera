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
  content: string;
  source?: string;
  instructions?: string;
  createdAt: Date;
  status: RawStatus;
  processedAt?: Date;
  error?: string;
}

export type TaskStatus = 'todo' | 'done';

export interface Task {
  _id?: string;
  title: string;
  deadline?: Date | null;
  description?: string;
  sourceRawId?: string;
  priority?: 'low' | 'normal' | 'high';
  status: TaskStatus;
  createdAt: Date;
}

export interface Note {
  _id?: string;
  title: string;
  content: string;
  tags?: string[];
  sourceRawId?: string;
  createdAt: Date;
}

export interface Attachment {
  _id?: string;
  filename: string;       // original filename (sanitized for display)
  storagePath: string;    // absolute path on disk inside the container
  size: number;
  mimeType?: string;
  createdAt: Date;
}

export interface BookmarkClick {
  _id: string;            // the URL itself
  count: number;
  lastAt: Date;
}
