import { Context, Hono } from 'hono';
import type { Env, SearchParams, Variables } from '../types';
import { getFileById, getFileByRemote, updateFile, deleteFile, deleteFileByRemote, searchFiles, upsertFile, getNestedIndex } from '../db/queries';
import { Errors, validationError } from '../errors';
import { createFileSchema, updateFileSchema, deleteByRemoteSchema, searchParamsSchema } from '../validation';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Helpers
// ============================================================================

function getSearchParams(c: Context): SearchParams {
  return {
    bucket: c.req.query('bucket'),
    category: c.req.query('category'),
    subcategory: c.req.query('subcategory'),
    entity: c.req.query('entity'),
    extension: c.req.query('extension'),
    media_type: c.req.query('media_type'),
    tags: c.req.query('tags'),
    deprecated: c.req.query('deprecated') as 'true' | 'false' | undefined,
    latest: c.req.query('latest') === 'true',
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
    group_by: c.req.query('group_by') as SearchParams['group_by'],
  };
}

function getFilterParams(c: Context): SearchParams {
  return {
    bucket: c.req.query('bucket'),
    category: c.req.query('category'),
    subcategory: c.req.query('subcategory'),
    entity: c.req.query('entity'),
    extension: c.req.query('extension'),
    media_type: c.req.query('media_type'),
    tags: c.req.query('tags'),
    deprecated: c.req.query('deprecated') as 'true' | 'false' | undefined,
  };
}

function setCacheHeaders(c: Context<{ Bindings: Env; Variables: Variables }>): void {
  const globalMaxAge = parseInt(c.env.CACHE_MAX_AGE || '60', 10);
  if (globalMaxAge < 0 || c.req.query('cache') === 'false') {
    c.header('Cache-Control', 'no-store');
    return;
  }
  c.header('Cache-Control', `public, max-age=${globalMaxAge}`);
}

// ============================================================================
// Routes
// ============================================================================

// List/search files
app.get('/', async (c) => {
  const params = getSearchParams(c);
  const parsed = searchParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  try {
    const result = await searchFiles(c.get('db'), parsed.data);
    setCacheHeaders(c);
    return c.json(result);
  } catch (e) {
    if (e instanceof Error && e.message.includes('Invalid group_by')) {
      return c.json(Errors.INVALID_GROUP_BY, 400);
    }
    throw e;
  }
});

// Create or update file metadata (upsert)
app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createFileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const { file, created } = await upsertFile(c.get('db'), parsed.data);
  return c.json(file, created ? 201 : 200);
});

// Get file by remote tuple
app.get('/by-tuple', async (c) => {
  const bucket = c.req.query('bucket');
  const remotePath = c.req.query('remote_path');
  const remoteFilename = c.req.query('remote_filename');
  const remoteVersion = c.req.query('remote_version');

  if (!bucket || !remotePath || !remoteFilename) {
    return c.json(validationError({
      bucket: !bucket ? ['bucket is required'] : [],
      remote_path: !remotePath ? ['remote_path is required'] : [],
      remote_filename: !remoteFilename ? ['remote_filename is required'] : [],
    }), 400);
  }

  const file = await getFileByRemote(c.get('db'), bucket, remotePath, remoteFilename, remoteVersion);

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return c.json(file);
});

// Get nested index (grouped by entity then extension)
app.get('/index', async (c) => {
  const params: SearchParams = {
    ...getFilterParams(c),
    latest: true,
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  };
  const index = await getNestedIndex(c.get('db'), params);

  setCacheHeaders(c);
  return c.json(index);
});

// Get file by ID
app.get('/:id', async (c) => {
  const file = await getFileById(c.get('db'), c.req.param('id'));

  if (!file) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return c.json(file);
});

// Update file metadata
app.put('/:id', async (c) => {
  const body = await c.req.json();
  const parsed = updateFileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  try {
    const file = await updateFile(c.get('db'), c.req.param('id'), parsed.data);

    if (!file) {
      return c.json(Errors.FILE_NOT_FOUND, 404);
    }

    return c.json(file);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
      return c.json(Errors.DUPLICATE_REMOTE_TUPLE, 409);
    }
    throw e;
  }
});

// Delete file metadata by ID
app.delete('/:id', async (c) => {
  const deleted = await deleteFile(c.get('db'), c.req.param('id'));

  if (!deleted) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return c.json({ success: true });
});

// Delete file metadata by remote tuple
app.delete('/', async (c) => {
  const body = await c.req.json();
  const parsed = deleteByRemoteSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const deleted = await deleteFileByRemote(
    c.get('db'),
    parsed.data.bucket,
    parsed.data.remote_path,
    parsed.data.remote_filename,
    parsed.data.remote_version
  );

  if (!deleted) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  return c.json({ success: true });
});

export default app;
