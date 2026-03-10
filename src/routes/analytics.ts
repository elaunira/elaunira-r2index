import { Context, Hono } from 'hono';
import type { AnalyticsScale, Env, Variables } from '../types';
import { getTimeSeries, getSummary, getDownloadsByIp, getUserAgentStats, getTopFiles, getFileDownloadCounts } from '../db/downloads';
import { parseLimit } from '../db/queries';
import { Errors, validationError } from '../errors';
import { analyticsParamsSchema } from '../validation';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function getAnalyticsParams(c: Context) {
  return {
    start: c.req.query('start'),
    end: c.req.query('end'),
    scale: c.req.query('scale'),
    bucket: c.req.query('bucket'),
    remote_path: c.req.query('remote_path'),
    remote_filename: c.req.query('remote_filename'),
    remote_version: c.req.query('remote_version'),
    category: c.req.query('category'),
    subcategory: c.req.query('subcategory'),
    entity: c.req.query('entity'),
    tags: c.req.query('tags'),
    ip: c.req.query('ip'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
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

// Get time series data
app.get('/timeseries', async (c) => {
  const params = getAnalyticsParams(c);
  const parsed = analyticsParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const { start, end, scale, bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags, limit } = parsed.data;
  const filesLimit = parseLimit(limit, 100, 1000);
  const data = await getTimeSeries(
    c.get('db'),
    parseInt(start, 10),
    parseInt(end, 10),
    (scale || 'day') as AnalyticsScale,
    { bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags },
    filesLimit
  );

  setCacheHeaders(c);
  return c.json({
    buckets: data,
    period: { start: parseInt(start, 10), end: parseInt(end, 10) },
    scale: scale || 'day',
  });
});

// Get summary stats
app.get('/summary', async (c) => {
  const params = getAnalyticsParams(c);
  const parsed = analyticsParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const { start, end, bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags } = parsed.data;
  const summary = await getSummary(
    c.get('db'),
    parseInt(start, 10),
    parseInt(end, 10),
    { bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags }
  );

  setCacheHeaders(c);
  return c.json(summary);
});

// Get downloads by IP
app.get('/by-ip', async (c) => {
  const params = getAnalyticsParams(c);
  const parsed = analyticsParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const { start, end, ip, limit, offset } = parsed.data;

  if (!ip) {
    return c.json(validationError({ ip: ['ip parameter is required'] }), 400);
  }

  const result = await getDownloadsByIp(
    c.get('db'),
    ip,
    parseInt(start, 10),
    parseInt(end, 10),
    parseLimit(limit, 100, 1000),
    parseInt(offset || '0', 10)
  );

  setCacheHeaders(c);
  return c.json(result);
});

// Get user agent stats
app.get('/user-agents', async (c) => {
  const params = getAnalyticsParams(c);
  const parsed = analyticsParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const { start, end, bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags, limit } = parsed.data;
  const data = await getUserAgentStats(
    c.get('db'),
    parseInt(start, 10),
    parseInt(end, 10),
    { bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags },
    parseLimit(limit, 20, 100)
  );

  setCacheHeaders(c);
  return c.json({
    user_agents: data,
    period: { start: parseInt(start, 10), end: parseInt(end, 10) },
  });
});

// Get top files by downloads
app.get('/top-files', async (c) => {
  const params = getAnalyticsParams(c);
  const parsed = analyticsParamsSchema.safeParse(params);

  if (!parsed.success) {
    return c.json(validationError(parsed.error.flatten().fieldErrors), 400);
  }

  const sortBy = c.req.query('sort_by') || 'downloads';
  if (sortBy !== 'downloads' && sortBy !== 'unique_downloads') {
    return c.json(validationError({ sort_by: ['sort_by must be downloads or unique_downloads'] }), 400);
  }

  const { start, end, bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags, limit, offset } = parsed.data;

  const result = await getTopFiles(
    c.get('db'),
    parseInt(start, 10),
    parseInt(end, 10),
    { bucket, remote_path, remote_filename, remote_version, category, subcategory, entity, tags },
    sortBy,
    parseLimit(limit, 100, 1000),
    parseInt(offset || '0', 10)
  );

  setCacheHeaders(c);
  return c.json(result);
});

// Get download counts for a single file
app.get('/file/:id/downloads', async (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  const scale = c.req.query('scale') || 'day';

  if (!start || !end || !/^\d+$/.test(start) || !/^\d+$/.test(end)) {
    return c.json(validationError({ start: ['start and end are required (unix ms timestamps)'] }), 400);
  }

  if (!['hour', 'day', 'month'].includes(scale)) {
    return c.json(validationError({ scale: ['scale must be hour, day, or month'] }), 400);
  }

  const startNum = parseInt(start, 10);
  const endNum = parseInt(end, 10);

  if (startNum > endNum) {
    return c.json(validationError({ start: ['start must be less than or equal to end'] }), 400);
  }

  const result = await getFileDownloadCounts(
    c.get('db'),
    c.req.param('id'),
    startNum,
    endNum,
    scale as AnalyticsScale
  );

  if (!result) {
    return c.json(Errors.FILE_NOT_FOUND, 404);
  }

  setCacheHeaders(c);
  return c.json(result);
});

export default app;
