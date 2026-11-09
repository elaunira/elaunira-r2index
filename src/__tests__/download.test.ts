import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setupDatabase } from './setup';

const READ_TOKEN = 'test-read-token';
const WRITE_TOKEN = 'test-write-token';

// Must match the R2 binding in wrangler.example.jsonc (bucket "r2index-e2e-tests" → R2INDEX_E2E_TESTS)
const BUCKET = 'r2index-e2e-tests';
const REMOTE_PATH = '/osm/planet/pbf';
const REMOTE_FILENAME = 'planet-latest.osm.pbf';
const REMOTE_VERSION = 'v1';
const R2_KEY = 'osm/planet/pbf/v1/planet-latest.osm.pbf';
const CONTENT = '0123456789abcdefghij'; // 20 bytes
const SIZE = CONTENT.length;

const DOWNLOAD_URL =
  `http://localhost/download?bucket=${BUCKET}&remote_path=${encodeURIComponent(REMOTE_PATH)}` +
  `&remote_filename=${REMOTE_FILENAME}&remote_version=${REMOTE_VERSION}`;

const r2 = () => env.R2INDEX_E2E_TESTS as R2Bucket;

function download(init: { method?: string; range?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${READ_TOKEN}` };
  if (init.range) headers.Range = init.range;
  return SELF.fetch(DOWNLOAD_URL, { method: init.method ?? 'GET', headers });
}

async function countDownloads(): Promise<number> {
  const row = await env.D1.prepare('SELECT COUNT(*) AS n FROM file_downloads').first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  await setupDatabase();
});

beforeEach(async () => {
  await env.D1.prepare('DELETE FROM file_downloads').run();
  await env.D1.prepare('DELETE FROM file_tags').run();
  await env.D1.prepare('DELETE FROM files').run();

  const created = await SELF.fetch('http://localhost/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${WRITE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: BUCKET,
      category: 'openstreetmap',
      entity: 'planet-pbf',
      extension: 'pbf',
      media_type: 'application/x-protobuf',
      remote_path: REMOTE_PATH,
      remote_filename: REMOTE_FILENAME,
      remote_version: REMOTE_VERSION,
      size: SIZE,
    }),
  });
  expect(created.status).toBe(201);

  await r2().put(R2_KEY, CONTENT);
});

describe('GET /download - full download', () => {
  it('streams the whole object with metadata headers', async () => {
    const response = await download();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
    expect(response.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${REMOTE_FILENAME}"`);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('ETag')).toBeTruthy();
  });

  it('sends Last-Modified set to the R2 upload time', async () => {
    const object = await r2().head(R2_KEY);
    const response = await download();
    await response.arrayBuffer();
    expect(response.headers.get('Last-Modified')).toBe(object!.uploaded.toUTCString());
  });

  it('records one download', async () => {
    const response = await download();
    await response.arrayBuffer();
    expect(await countDownloads()).toBe(1);
  });

  it('returns 404 when the R2 object is missing', async () => {
    await r2().delete(R2_KEY);
    const response = await download();
    expect(response.status).toBe(404);
  });
});

describe('HEAD /download', () => {
  it('returns the same headers as GET without a body', async () => {
    const object = await r2().head(R2_KEY);
    const response = await download({ method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('ETag')).toBe(object!.httpEtag);
    expect(response.headers.get('Last-Modified')).toBe(object!.uploaded.toUTCString());
  });

  it('does not record a download', async () => {
    const response = await download({ method: 'HEAD' });
    await response.arrayBuffer();
    expect(await countDownloads()).toBe(0);
  });

  it('describes the requested range', async () => {
    const response = await download({ method: 'HEAD', range: 'bytes=-5' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Range')).toBe(`bytes 15-19/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe('5');
  });

  it('returns 404 when the R2 object is missing', async () => {
    await r2().delete(R2_KEY);
    const response = await download({ method: 'HEAD' });
    expect(response.status).toBe(404);
  });

  it('is allowed by CORS preflight', async () => {
    const response = await SELF.fetch(DOWNLOAD_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'HEAD',
      },
    });
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('HEAD');
  });
});

describe('GET /download - range requests', () => {
  it('serves a bounded range', async () => {
    const response = await download({ range: 'bytes=0-4' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('01234');
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-4/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(response.headers.get('Last-Modified')).toBeTruthy();
  });

  it('serves an open-ended range', async () => {
    const response = await download({ range: 'bytes=15-' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('fghij');
    expect(response.headers.get('Content-Range')).toBe(`bytes 15-19/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe('5');
  });

  it('clamps a range ending past the object', async () => {
    const response = await download({ range: 'bytes=18-100' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('ij');
    expect(response.headers.get('Content-Range')).toBe(`bytes 18-19/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe('2');
  });

  it('serves a suffix range (last N bytes)', async () => {
    const response = await download({ range: 'bytes=-5' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('fghij');
    expect(response.headers.get('Content-Range')).toBe(`bytes 15-19/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe('5');
  });

  it('serves the whole object for a suffix longer than the object', async () => {
    const response = await download({ range: 'bytes=-100' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-19/${SIZE}`);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
  });

  it('returns 416 for a range starting past the object', async () => {
    const response = await download({ range: 'bytes=100-' });
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('returns 416 for an empty suffix range', async () => {
    const response = await download({ range: 'bytes=-0' });
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('ignores a malformed range and serves the whole object', async () => {
    const response = await download({ range: 'bytes=abc' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
    expect(response.headers.get('Content-Range')).toBeNull();
  });

  it('ignores a multi-range request and serves the whole object', async () => {
    const response = await download({ range: 'bytes=0-1,5-6' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('Content-Length')).toBe(String(SIZE));
  });

  it('records a download only for a range starting at byte 0', async () => {
    await (await download({ range: 'bytes=0-4' })).arrayBuffer();
    await (await download({ range: 'bytes=5-9' })).arrayBuffer();
    await (await download({ range: 'bytes=-5' })).arrayBuffer();
    expect(await countDownloads()).toBe(1);
  });
});
