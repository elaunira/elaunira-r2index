import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setupDatabase } from './setup';

const READ_TOKEN = 'test-read-token';
const WRITE_TOKEN = 'test-write-token';

const createReadHeaders = () => ({
  Authorization: `Bearer ${READ_TOKEN}`,
  'Content-Type': 'application/json',
});

const createWriteHeaders = () => ({
  Authorization: `Bearer ${WRITE_TOKEN}`,
  'Content-Type': 'application/json',
});

// Write headers used for setup (creating test data) and write operations
const createAuthHeaders = createWriteHeaders;

const validDownloadInput = {
  bucket: 'test-bucket',
  remote_path: '/uploads/documents',
  remote_filename: 'report.pdf',
  remote_version: 'v1',
  ip_address: '192.168.1.1',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
};

beforeAll(async () => {
  await setupDatabase();
});

describe('POST /downloads - Record download', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();
  });

  it('records a download with all fields', async () => {
    const response = await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });
    expect(response.status).toBe(201);
    const data = await response.json() as {
      id: string;
      remote_path: string;
      ip_address: string;
      downloaded_at: number;
      hour_bucket: number;
      day_bucket: number;
      month_bucket: number;
    };
    expect(data.id).toBeTruthy();
    expect(data.remote_path).toBe('/uploads/documents');
    expect(data.ip_address).toBe('192.168.1.1');
    expect(data.downloaded_at).toBeGreaterThan(0);
    expect(data.hour_bucket).toBeGreaterThan(0);
    expect(data.day_bucket).toBeGreaterThan(0);
    expect(data.month_bucket).toBeGreaterThan(0);
  });

  it('records a download without user_agent', async () => {
    const { user_agent, ...input } = validDownloadInput;
    const response = await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
  });

  it('records a download without remote_version', async () => {
    const { remote_version, ...input } = validDownloadInput;
    const response = await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    const data = await response.json() as { id: string; remote_version: string | null };
    expect(data.id).toBeTruthy();
    expect(data.remote_version).toBeNull();
  });

  it('rejects missing required fields', async () => {
    const response = await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ip_address: '192.168.1.1' }),
    });
    expect(response.status).toBe(400);
  });

  it('computes correct time buckets', async () => {
    const response = await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });
    const data = await response.json() as {
      downloaded_at: number;
      hour_bucket: number;
      day_bucket: number;
      month_bucket: number;
    };

    // hour_bucket should be start of the hour
    expect(data.hour_bucket % 3600000).toBe(0);
    expect(data.hour_bucket).toBeLessThanOrEqual(data.downloaded_at);
    expect(data.hour_bucket + 3600000).toBeGreaterThan(data.downloaded_at);

    // day_bucket should be start of the day
    expect(data.day_bucket % 86400000).toBe(0);

    // month_bucket should be YYYYMM format
    const date = new Date(data.downloaded_at);
    const expectedMonth = date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
    expect(data.month_bucket).toBe(expectedMonth);
  });
});

describe('GET /analytics/timeseries', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    // Create test downloads
    for (let i = 0; i < 5; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...validDownloadInput,
          ip_address: `192.168.1.${i + 1}`,
        }),
      });
    }
  });

  it('returns time series with daily scale and per-file breakdown', async () => {
    const now = Date.now();
    const start = now - 86400000;
    const end = now + 86400000;

    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${start}&end=${end}&scale=day`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as {
      scale: string;
      buckets: {
        timestamp: number;
        files: { remote_path: string; remote_filename: string; remote_version: string; downloads: number; unique_downloads: number }[];
        total_downloads: number;
        total_unique_downloads: number;
      }[];
    };
    expect(data.scale).toBe('day');
    expect(data.buckets.length).toBeGreaterThan(0);
    expect(data.buckets[0].total_downloads).toBe(5);
    expect(data.buckets[0].total_unique_downloads).toBe(5);
    expect(data.buckets[0].files.length).toBe(1);
    expect(data.buckets[0].files[0].remote_path).toBe('/uploads/documents');
    expect(data.buckets[0].files[0].downloads).toBe(5);
  });

  it('returns time series with hourly scale', async () => {
    const now = Date.now();
    const start = now - 3600000;
    const end = now + 3600000;

    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${start}&end=${end}&scale=hour`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as { scale: string; buckets: unknown[] };
    expect(data.scale).toBe('hour');
  });

  it('filters by file', async () => {
    // Add downloads for another file
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validDownloadInput, remote_filename: 'other.pdf', ip_address: '10.0.0.1' }),
    });

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day&remote_filename=report.pdf`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { total_downloads: number; files: unknown[] }[] };
    expect(data.buckets[0].total_downloads).toBe(5); // Only original file
    expect(data.buckets[0].files.length).toBe(1);
  });

  it('includes Cache-Control header', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});

describe('GET /analytics/summary', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    for (let i = 0; i < 3; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...validDownloadInput,
          ip_address: `192.168.1.${i + 1}`,
          user_agent: i < 2 ? 'Chrome/120' : 'Safari/17',
        }),
      });
    }
  });

  it('returns summary with totals', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/summary?start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as {
      total_downloads: number;
      unique_downloads: number;
      top_user_agents: { user_agent: string; downloads: number }[];
      period: { start: number; end: number };
    };
    expect(data.total_downloads).toBe(3);
    expect(data.unique_downloads).toBe(3);
    expect(data.top_user_agents.length).toBe(2);
    expect(data.top_user_agents[0].downloads).toBe(2); // Chrome
    expect(data.period.start).toBeLessThan(data.period.end);
  });
});

describe('GET /analytics/by-ip', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    for (let i = 0; i < 3; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...validDownloadInput,
          remote_filename: `file${i}.pdf`,
        }),
      });
    }
  });

  it('returns downloads for IP', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?ip=192.168.1.1&start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as { downloads: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.downloads.length).toBe(3);
  });

  it('requires ip parameter', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(400);
  });

  it('supports pagination', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?ip=192.168.1.1&start=${now - 86400000}&end=${now + 86400000}&limit=2`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { downloads: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.downloads.length).toBe(2);
  });
});

describe('GET /analytics/user-agents', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    const userAgents = ['Chrome/120', 'Chrome/120', 'Safari/17', 'Firefox/121'];
    for (let i = 0; i < userAgents.length; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...validDownloadInput,
          ip_address: `192.168.1.${i + 1}`,
          user_agent: userAgents[i],
        }),
      });
    }
  });

  it('returns user agent stats', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/user-agents?start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as { user_agents: { user_agent: string; downloads: number; unique_ips: number }[] };
    expect(data.user_agents.length).toBe(3);
    expect(data.user_agents[0].user_agent).toBe('Chrome/120');
    expect(data.user_agents[0].downloads).toBe(2);
    expect(data.user_agents[0].unique_ips).toBe(2);
  });

  it('respects limit parameter', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/user-agents?start=${now - 86400000}&end=${now + 86400000}&limit=2`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { user_agents: unknown[] };
    expect(data.user_agents.length).toBe(2);
  });

  it('filters by file', async () => {
    // Add download for different file
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validDownloadInput, remote_filename: 'other.pdf', user_agent: 'Edge/120', ip_address: '10.0.0.1' }),
    });

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/user-agents?start=${now - 86400000}&end=${now + 86400000}&remote_filename=report.pdf`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { user_agents: { user_agent: string }[] };
    expect(data.user_agents.find(d => d.user_agent === 'Edge/120')).toBeUndefined();
  });
});

describe('Analytics - file id inclusion', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();
  });

  it('includes file id when file exists in index', async () => {
    // Create a file in the index
    const fileResponse = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({
        bucket: 'test-bucket',
        category: 'test',
        entity: 'test-entity',
        extension: 'pdf',
        media_type: 'application/pdf',
        remote_path: '/uploads/documents',
        remote_filename: 'report.pdf',
        remote_version: 'v1',
      }),
    });
    const file = await fileResponse.json() as { id: string };

    // Record a download
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });

    // Check timeseries includes file id
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { files: { id: string | null }[] }[] };
    expect(data.buckets[0].files[0].id).toBe(file.id);
  });

  it('returns null id when file does not exist in index', async () => {
    // Record a download without creating file in index
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { files: { id: string | null }[] }[] };
    expect(data.buckets[0].files[0].id).toBeNull();
  });
});

describe('Analytics - multiple files', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    // Create downloads for multiple files
    const files = [
      { ...validDownloadInput, remote_filename: 'file1.pdf' },
      { ...validDownloadInput, remote_filename: 'file1.pdf', ip_address: '10.0.0.1' },
      { ...validDownloadInput, remote_filename: 'file2.pdf', ip_address: '10.0.0.2' },
    ];
    for (const file of files) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify(file),
      });
    }
  });

  it('returns per-file breakdown in timeseries', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as {
      buckets: {
        files: { remote_filename: string; downloads: number; unique_downloads: number }[];
        total_downloads: number;
        total_unique_downloads: number;
      }[];
    };

    expect(data.buckets[0].files.length).toBe(2);
    expect(data.buckets[0].total_downloads).toBe(3);
    // file1.pdf has 2 downloads from 2 unique IPs, file2.pdf has 1 download
    const file1 = data.buckets[0].files.find(f => f.remote_filename === 'file1.pdf');
    const file2 = data.buckets[0].files.find(f => f.remote_filename === 'file2.pdf');
    expect(file1?.downloads).toBe(2);
    expect(file1?.unique_downloads).toBe(2);
    expect(file2?.downloads).toBe(1);
  });

  it('calculates total unique downloads across files correctly', async () => {
    // Add download from same IP but different file
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validDownloadInput, remote_filename: 'file3.pdf' }), // Same IP as file1.pdf first download
    });

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { total_downloads: number; total_unique_downloads: number }[] };

    expect(data.buckets[0].total_downloads).toBe(4);
    // 3 unique IPs total (192.168.1.1 downloaded 2 files, 10.0.0.1 and 10.0.0.2 each downloaded 1)
    expect(data.buckets[0].total_unique_downloads).toBe(3);
  });
});

describe('Analytics - time scales', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });
  });

  it('returns monthly scale with YYYYMM bucket', async () => {
    const now = Date.now();
    const date = new Date(now);
    const expectedMonth = date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);

    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000 * 30}&end=${now + 86400000}&scale=month`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { scale: string; buckets: { timestamp: number }[] };

    expect(data.scale).toBe('month');
    expect(data.buckets[0].timestamp).toBe(expectedMonth);
  });

  it('defaults to daily scale', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { scale: string };
    expect(data.scale).toBe('day');
  });
});

describe('Analytics - validation', () => {
  it('requires start parameter', async () => {
    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?end=1706745600000',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(400);
  });

  it('requires end parameter', async () => {
    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?start=1704067200000',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(400);
  });

  it('rejects invalid scale', async () => {
    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?start=1704067200000&end=1706745600000&scale=year',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(400);
  });

  it('rejects start greater than end', async () => {
    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?start=1706745600000&end=1704067200000',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(400);
    const data = await response.json() as { error: { details: { start: string[] } } };
    expect(data.error.details.start).toContain('start must be less than or equal to end');
  });

  it('accepts start equal to end', async () => {
    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?start=1704067200000&end=1704067200000',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
  });

  it('returns empty data for time range with no downloads', async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    const response = await SELF.fetch(
      'http://localhost/analytics/timeseries?start=1704067200000&end=1706745600000&scale=day',
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as { buckets: unknown[] };
    expect(data.buckets).toEqual([]);
  });
});

describe('Analytics summary - filters', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    // Downloads for file1
    for (let i = 0; i < 3; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({ ...validDownloadInput, remote_filename: 'file1.pdf', ip_address: `192.168.1.${i}` }),
      });
    }
    // Downloads for file2
    for (let i = 0; i < 2; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({ ...validDownloadInput, remote_filename: 'file2.pdf', ip_address: `10.0.0.${i}` }),
      });
    }
  });

  it('filters summary by file', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/summary?start=${now - 86400000}&end=${now + 86400000}&remote_filename=file1.pdf`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { total_downloads: number; unique_downloads: number };
    expect(data.total_downloads).toBe(3);
    expect(data.unique_downloads).toBe(3);
  });

  it('returns zero for non-matching filter', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/summary?start=${now - 86400000}&end=${now + 86400000}&remote_filename=nonexistent.pdf`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { total_downloads: number; unique_downloads: number };
    expect(data.total_downloads).toBe(0);
    expect(data.unique_downloads).toBe(0);
  });
});

describe('Analytics by-ip - edge cases', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();
  });

  it('returns empty for IP with no downloads', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?ip=1.2.3.4&start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { downloads: unknown[]; total: number };
    expect(data.total).toBe(0);
    expect(data.downloads).toEqual([]);
  });

  it('returns downloads in descending order by time', async () => {
    // Create downloads with slight delay
    for (let i = 0; i < 3; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({ ...validDownloadInput, remote_filename: `file${i}.pdf` }),
      });
    }

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?ip=192.168.1.1&start=${now - 86400000}&end=${now + 86400000}`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { downloads: { downloaded_at: number }[] };

    // Should be in descending order
    for (let i = 0; i < data.downloads.length - 1; i++) {
      expect(data.downloads[i].downloaded_at).toBeGreaterThanOrEqual(data.downloads[i + 1].downloaded_at);
    }
  });

  it('supports offset pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await SELF.fetch('http://localhost/downloads', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify({ ...validDownloadInput, remote_filename: `file${i}.pdf` }),
      });
    }

    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/by-ip?ip=192.168.1.1&start=${now - 86400000}&end=${now + 86400000}&limit=2&offset=2`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { downloads: unknown[]; total: number };
    expect(data.total).toBe(5);
    expect(data.downloads.length).toBe(2);
  });
});

describe('Analytics - files limit', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();

    // Create downloads for many files
    for (let i = 0; i < 10; i++) {
      // Each file gets a different number of downloads (10-i)
      for (let j = 0; j < 10 - i; j++) {
        await SELF.fetch('http://localhost/downloads', {
          method: 'POST',
          headers: createAuthHeaders(),
          body: JSON.stringify({
            ...validDownloadInput,
            remote_filename: `file${i}.pdf`,
            ip_address: `192.168.${i}.${j}`,
          }),
        });
      }
    }
  });

  it('limits files per bucket with limit parameter', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day&limit=3`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { files: unknown[]; total_downloads: number }[] };

    // Should only return 3 files per bucket
    expect(data.buckets[0].files.length).toBe(3);
    // But total_downloads should still count all downloads
    expect(data.buckets[0].total_downloads).toBe(55); // Sum of 10+9+8+...+1 = 55
  });

  it('returns files ordered by downloads descending', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day&limit=5`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { files: { downloads: number }[] }[] };

    const files = data.buckets[0].files;
    for (let i = 0; i < files.length - 1; i++) {
      expect(files[i].downloads).toBeGreaterThanOrEqual(files[i + 1].downloads);
    }
  });

  it('defaults to 100 files limit', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day`,
      { headers: createAuthHeaders() }
    );
    const data = await response.json() as { buckets: { files: unknown[] }[] };

    // With only 10 files, all should be returned
    expect(data.buckets[0].files.length).toBe(10);
  });

  it('enforces max limit of 1000', async () => {
    const now = Date.now();
    const response = await SELF.fetch(
      `http://localhost/analytics/timeseries?start=${now - 86400000}&end=${now + 86400000}&scale=day&limit=2000`,
      { headers: createAuthHeaders() }
    );
    // Request should succeed (limit capped at 1000)
    expect(response.status).toBe(200);
  });
});

describe('POST /maintenance/cleanup-downloads', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_downloads').run();
  });

  it('deletes old downloads based on retention days', async () => {
    // Insert an old download directly (400 days ago)
    const oldTimestamp = Date.now() - (400 * 24 * 60 * 60 * 1000);
    const oldBuckets = {
      hour_bucket: Math.floor(oldTimestamp / 3600000) * 3600000,
      day_bucket: Math.floor(oldTimestamp / 86400000) * 86400000,
      month_bucket: new Date(oldTimestamp).getUTCFullYear() * 100 + (new Date(oldTimestamp).getUTCMonth() + 1),
    };

    await env.D1.prepare(`
      INSERT INTO file_downloads (id, bucket, remote_path, remote_filename, remote_version, ip_address, user_agent, downloaded_at, hour_bucket, day_bucket, month_bucket)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'old-download-id',
      'test-bucket',
      '/old/path',
      'old.pdf',
      'v1',
      '1.2.3.4',
      'OldBrowser/1.0',
      oldTimestamp,
      oldBuckets.hour_bucket,
      oldBuckets.day_bucket,
      oldBuckets.month_bucket
    ).run();

    // Insert a recent download
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });

    // Verify we have 2 downloads
    const countBefore = await env.D1.prepare('SELECT COUNT(*) as count FROM file_downloads').first<{ count: number }>();
    expect(countBefore?.count).toBe(2);

    // Run cleanup (default 365 days retention)
    const response = await SELF.fetch('http://localhost/maintenance/cleanup-downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
    });

    expect(response.status).toBe(200);
    const data = await response.json() as { deleted_count: number; retention_days: number };
    expect(data.deleted_count).toBe(1);
    expect(data.retention_days).toBe(365);

    // Verify only 1 download remains
    const countAfter = await env.D1.prepare('SELECT COUNT(*) as count FROM file_downloads').first<{ count: number }>();
    expect(countAfter?.count).toBe(1);
  });

  it('returns zero deleted when no old downloads', async () => {
    // Insert only a recent download
    await SELF.fetch('http://localhost/downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validDownloadInput),
    });

    const response = await SELF.fetch('http://localhost/maintenance/cleanup-downloads', {
      method: 'POST',
      headers: createAuthHeaders(),
    });

    expect(response.status).toBe(200);
    const data = await response.json() as { deleted_count: number };
    expect(data.deleted_count).toBe(0);
  });
});
