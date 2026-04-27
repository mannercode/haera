import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
const region = process.env.S3_REGION?.trim() || 'us-east-1';
const accessKey = process.env.S3_ACCESS_KEY?.trim();
const secretKey = process.env.S3_SECRET_KEY?.trim();
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true';

export const bucket = process.env.S3_BUCKET?.trim() || 'haera';

declare global {
  // eslint-disable-next-line no-var
  var _haeraS3: S3Client | undefined;
  // eslint-disable-next-line no-var
  var _haeraBucketReady: boolean | undefined;
}

function getClient(): S3Client {
  if (!global._haeraS3) {
    global._haeraS3 = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials:
        accessKey && secretKey
          ? { accessKeyId: accessKey, secretAccessKey: secretKey }
          : undefined,
    });
  }
  return global._haeraS3;
}

export async function ensureBucket(): Promise<void> {
  if (global._haeraBucketReady) return;
  const c = getClient();
  try {
    await c.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await c.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (e) {
      // 409 means bucket already exists (race condition). Otherwise rethrow.
      const code = (e as { name?: string; Code?: string }).name ?? '';
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(code)) throw e;
    }
  }
  global._haeraBucketReady = true;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  await ensureBucket();
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!r.Body) throw new Error('empty body');
  // SDK v3 returns a stream-like body; collect into a buffer.
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of r.Body as AsyncIterable<any>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Identify whether a stored path is a legacy local-disk path (pre-MinIO migration)
 * or an S3 object key.
 */
export function isLegacyLocalPath(p: string): boolean {
  return p.startsWith('/');
}
