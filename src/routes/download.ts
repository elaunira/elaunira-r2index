import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getFileById, getFileByRemote } from '../db/queries';
import { createDownload } from '../db/downloads';
import { Errors } from '../errors';
import type { FileRecord } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildR2Key(file: FileRecord): string {
  const parts = [file.remote_path.replace(/^\/|\/$/g, '')];
  if (file.remote_version) {
    parts.push(file.remote_version);
  }
  parts.push(file.remote_filename);
  return parts.join('/');
}

/** A single byte range as written in a Range header, before it is resolved against the object size. */
type RequestedRange =
  | { kind: 'bounded'; start: number; end: number | null }
  | { kind: 'suffix'; length: number };

/**
 * Parses a single-range "bytes=" Range header (RFC 9110 §14.1.1). Returns null for
 * malformed or multi-range headers, which are ignored so the whole object is served.
 */
function parseRangeHeader(range: string): RequestedRange | null {
  const match = range.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, first, last] = match;

  if (first === '') {
    if (last === '') return null;
    return { kind: 'suffix', length: parseInt(last, 10) };
  }

  const start = parseInt(first, 10);
  const end = last === '' ? null : parseInt(last, 10);
  if (end !== null && end < start) return null;
  return { kind: 'bounded', start, end };
}

/** Resolves a requested range against the object size; null means it is unsatisfiable. */
function resolveRange(range: RequestedRange, size: number): { start: number; end: number } | null {
  if (range.kind === 'suffix') {
    if (range.length === 0 || size === 0) return null;
    return { start: Math.max(0, size - range.length), end: size - 1 };
  }
  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
}

function getClientUserAgent(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('x-forwarded-user-agent') ?? c.req.header('user-agent') ?? null;
}

/** Converts a bucket name to its expected R2 binding name (e.g. "my-assets" → "MY_ASSETS"). */
function toBindingName(bucket: string): string {
  return bucket.replace(/-/g, '_').toUpperCase();
}

function getR2Bucket(env: Env, bucket: string): R2Bucket | null {
  const bindingName = toBindingName(bucket);
  const binding = env[bindingName];
  if (binding && typeof binding === 'object' && 'get' in binding) {
    return binding as R2Bucket;
  }
  return null;
}

async function streamDownload(
  c: { req: { header: (name: string) => string | undefined; method: string }; env: Env; get: (key: string) => any; json: (data: any, status: number) => Response },
  file: FileRecord,
): Promise<Response> {
  const r2Bucket = getR2Bucket(c.env, file.bucket);
  if (!r2Bucket) {
    return c.json(Errors.R2_BUCKET_NOT_BOUND, 500);
  }

  const r2Key = buildR2Key(file);
  const rangeHeader = c.req.header('range');
  const requestedRange = rangeHeader ? parseRangeHeader(rangeHeader) : null;
  const isHead = c.req.method === 'HEAD';

  // HEAD never reads the body, and a range is resolved against the object size
  // before fetching so the response always describes exactly the bytes it carries.
  const meta = isHead || requestedRange ? await r2Bucket.head(r2Key) : null;
  if ((isHead || requestedRange) && !meta) {
    return c.json(Errors.R2_OBJECT_NOT_FOUND, 404);
  }

  const range = requestedRange && meta ? resolveRange(requestedRange, meta.size) : null;
  if (requestedRange && meta && !range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${meta.size}`, 'Accept-Ranges': 'bytes' },
    });
  }

  let object: R2Object | null = meta;
  let body: ReadableStream | null = null;
  if (!isHead) {
    const fetched = await r2Bucket.get(
      r2Key,
      range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
    );
    if (!fetched) {
      return c.json(Errors.R2_OBJECT_NOT_FOUND, 404);
    }
    object = fetched;
    body = fetched.body;
  }

  // Record download only for GET (not HEAD) and only for full requests or a range starting at byte 0
  if (!isHead && (!range || range.start === 0)) {
    const ip = getClientIp(c);
    const userAgent = getClientUserAgent(c);

    await createDownload(c.get('db'), {
      bucket: file.bucket,
      remote_path: file.remote_path,
      remote_filename: file.remote_filename,
      remote_version: file.remote_version ?? undefined,
      ip_address: ip,
      user_agent: userAgent ?? undefined,
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', file.media_type || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${file.remote_filename}"`);
  headers.set('ETag', object!.httpEtag);
  headers.set('Last-Modified', object!.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'bytes');

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object!.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object!.size));
  return new Response(body, { headers });
}

// Download file by ID
app.get('/:id', async (c) => {
  const file = await getFileById(c.get('db'), c.req.param('id'));

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return streamDownload(c, file);
});

// Download file by remote tuple
app.get('/', async (c) => {
  const bucket = c.req.query('bucket');
  const remotePath = c.req.query('remote_path');
  const remoteFilename = c.req.query('remote_filename');
  const remoteVersion = c.req.query('remote_version');
  const latest = c.req.query('latest') === 'true';

  if (!bucket || !remotePath || !remoteFilename) {
    return c.json(Errors.MISSING_REMOTE_TUPLE, 400);
  }

  const file = await getFileByRemote(c.get('db'), bucket, remotePath, remoteFilename, remoteVersion, latest);

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return streamDownload(c, file);
});

export default app;
