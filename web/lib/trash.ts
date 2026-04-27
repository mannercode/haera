import { Db } from 'mongodb';
import { TrashItem, TrashKind } from './mongodb';

/**
 * Snapshot a doc into the `trash` collection so it can be restored later.
 * The original collection still needs a separate delete after this call.
 */
export async function trashDoc(
  db: Db,
  ownerId: string,
  kind: TrashKind,
  doc: { _id: unknown } & Record<string, unknown>,
): Promise<void> {
  const { _id, ...payload } = doc;
  const entry: TrashItem = {
    ownerId,
    kind,
    originalId: String(_id),
    payload,
    deletedAt: new Date(),
  };
  await db.collection<TrashItem>('trash').insertOne(entry);
}
