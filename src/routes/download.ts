import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getFileById, getFileByRemote } from '../db/queries';
import { createDownload } from '../db/downloads';
import { Errors } from '../errors';
import type { FileRecord } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Returns true if this is a full download or the first byte-range chunk (starts at 0). */
function isInitialRequest(rangeHeader: string | undefined): boolean {
  if (!rangeHeader) return true;
  const match = rangeHeader.match(/^bytes=(\d+)-/);
  return match !== null && match[1] === '0';
}

function buildR2Key(file: FileRecord): string {
  const parts = [file.remote_path.replace(/^\/|\/$/g, '')];
  if (file.remote_version) {
    parts.push(file.remote_version);
  }
  parts.push(file.remote_filename);
  return parts.join('/');
}

function parseRangeHeader(
  range: string,
  totalSize: number,
): { start: number; end: number } | null {
  const match = range.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (start > end || start >= totalSize) return null;
  return { start, end: Math.min(end, totalSize - 1) };
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

async function streamDownload(
  c: { req: { header: (name: string) => string | undefined; method: string }; env: Env; get: (key: string) => any; json: (data: any, status: number) => Response },
  file: FileRecord,
): Promise<Response> {
  const r2Key = buildR2Key(file);
  const rangeHeader = c.req.header('range');

  const object = await c.env.R2.get(
    r2Key,
    rangeHeader ? { range: new Headers({ range: rangeHeader }) } : undefined,
  );

  if (!object) {
    return c.json(Errors.R2_OBJECT_NOT_FOUND, 404);
  }

  // Record download only for GET (not HEAD) and only for full requests or first byte-range chunk
  if (c.req.method === 'GET' && isInitialRequest(rangeHeader)) {
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
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, object.size);
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
      headers.set('Content-Length', String(range.end - range.start + 1));
      return new Response(object.body, { status: 206, headers });
    }
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
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
