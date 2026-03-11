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

// Download file by ID
app.get('/:id', async (c) => {
  const file = await getFileById(c.get('db'), c.req.param('id'));

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  const r2Key = buildR2Key(file);
  const object = await c.env.R2.get(r2Key);

  if (!object) {
    return c.json(Errors.R2_OBJECT_NOT_FOUND, 404);
  }

  // Record download only for full requests or first byte-range chunk
  if (isInitialRequest(c.req.header('range'))) {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
    const userAgent = c.req.header('user-agent') ?? null;

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
  if (file.size !== null) {
    headers.set('Content-Length', String(file.size));
  }
  headers.set('Content-Disposition', `attachment; filename="${file.remote_filename}"`);
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
});

// Download file by remote tuple
app.get('/', async (c) => {
  const bucket = c.req.query('bucket');
  const remotePath = c.req.query('remote_path');
  const remoteFilename = c.req.query('remote_filename');
  const remoteVersion = c.req.query('remote_version');

  if (!bucket || !remotePath || !remoteFilename) {
    return c.json(Errors.MISSING_REMOTE_TUPLE, 400);
  }

  const file = await getFileByRemote(c.get('db'), bucket, remotePath, remoteFilename, remoteVersion);

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  const r2Key = buildR2Key(file);
  const object = await c.env.R2.get(r2Key);

  if (!object) {
    return c.json(Errors.R2_OBJECT_NOT_FOUND, 404);
  }

  // Record download only for full requests or first byte-range chunk
  if (isInitialRequest(c.req.header('range'))) {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
    const userAgent = c.req.header('user-agent') ?? null;

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
  if (file.size !== null) {
    headers.set('Content-Length', String(file.size));
  }
  headers.set('Content-Disposition', `attachment; filename="${file.remote_filename}"`);
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default app;
