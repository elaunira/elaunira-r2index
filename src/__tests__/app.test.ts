import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setupDatabase } from './setup';

const API_TOKEN = 'test-token';

beforeAll(async () => {
  await setupDatabase();
});

const createAuthHeaders = () => ({
  Authorization: `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json',
});

const validFileInput = {
  bucket: 'test-bucket',
  category: 'documents',
  entity: 'user-123',
  extension: 'pdf',
  media_type: 'application/pdf',
  remote_path: '/uploads/documents',
  remote_filename: 'report.pdf',
  remote_version: 'v1',
};

describe('Health endpoint', () => {
  it('returns ok status without auth', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('includes X-Request-ID header', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('uses provided X-Request-ID', async () => {
    const requestId = 'custom-request-id-123';
    const response = await SELF.fetch('http://localhost/health', {
      headers: { 'X-Request-ID': requestId },
    });
    expect(response.headers.get('X-Request-ID')).toBe(requestId);
  });
});

describe('Authentication', () => {
  it('rejects requests without Authorization header', async () => {
    const response = await SELF.fetch('http://localhost/files');
    expect(response.status).toBe(401);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('MISSING_AUTH_HEADER');
  });

  it('rejects requests with invalid auth format', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(response.status).toBe(401);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('INVALID_AUTH_FORMAT');
  });

  it('rejects requests with invalid token', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(response.status).toBe(403);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('INVALID_TOKEN');
  });

  it('accepts requests with valid token', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
  });
});

describe('404 handling', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const response = await SELF.fetch('http://localhost/unknown-route', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(404);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /files - Create file', () => {
  beforeEach(async () => {
    // Clean up database
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();
  });

  it('creates a file with minimal input', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
    expect(response.status).toBe(201);
    const data = await response.json() as { id: string; category: string };
    expect(data.id).toBeTruthy();
    expect(data.category).toBe('documents');
  });

  it('creates a file with all fields', async () => {
    const input = {
      ...validFileInput,
      name: 'Monthly Report',
      checksum_md5: 'd41d8cd98f00b204e9800998ecf8427e',
      size: 1024,
      tags: ['important', 'monthly'],
      extra: { author: 'John' },
    };

    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    const data = await response.json() as {
      name: string;
      checksum_md5: string;
      size: number;
      tags: string[];
      extra: { author: string };
    };
    expect(data.name).toBe('Monthly Report');
    expect(data.checksum_md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(data.size).toBe(1024);
    expect(data.tags).toContain('important');
    expect(data.tags).toContain('monthly');
    expect(data.extra).toEqual({ author: 'John' });
  });

  it('upserts existing file (returns 200)', async () => {
    // Create first
    await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });

    // Upsert with updated name
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validFileInput, name: 'Updated Name' }),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { name: string };
    expect(data.name).toBe('Updated Name');
  });

  it('rejects invalid input', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ category: '' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: 'not json',
    });
    expect(response.status).toBe(400);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('INVALID_JSON');
    consoleSpy.mockRestore();
  });
});

describe('POST /files - Create file without version', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();
  });

  it('creates a file without remote_version', async () => {
    const { remote_version, ...inputWithoutVersion } = validFileInput;
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(inputWithoutVersion),
    });
    expect(response.status).toBe(201);
    const data = await response.json() as { id: string; remote_version: string | null };
    expect(data.id).toBeTruthy();
    expect(data.remote_version).toBeNull();
  });

  it('retrieves file without version via by-tuple', async () => {
    const { remote_version, ...inputWithoutVersion } = validFileInput;
    await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(inputWithoutVersion),
    });

    const response = await SELF.fetch(
      `http://localhost/files/by-tuple?bucket=${validFileInput.bucket}&remote_path=${encodeURIComponent(validFileInput.remote_path)}&remote_filename=${validFileInput.remote_filename}`,
      { headers: createAuthHeaders() }
    );
    expect(response.status).toBe(200);
    const data = await response.json() as { remote_version: string | null };
    expect(data.remote_version).toBeNull();
  });

  it('deletes file without version via remote tuple', async () => {
    const { remote_version, ...inputWithoutVersion } = validFileInput;
    await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(inputWithoutVersion),
    });

    const response = await SELF.fetch('http://localhost/files', {
      method: 'DELETE',
      headers: createAuthHeaders(),
      body: JSON.stringify({
        bucket: validFileInput.bucket,
        remote_path: validFileInput.remote_path,
        remote_filename: validFileInput.remote_filename,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(true);
  });
});

describe('GET /files - Search files', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    // Create test files
    const files = [
      { ...validFileInput, category: 'documents', entity: 'user-1', extension: 'pdf' },
      { ...validFileInput, category: 'documents', entity: 'user-1', extension: 'docx', remote_filename: 'doc.docx' },
      { ...validFileInput, category: 'images', entity: 'user-2', extension: 'png', remote_filename: 'img.png', media_type: 'image/png' },
    ];

    for (const file of files) {
      await SELF.fetch('http://localhost/files', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify(file),
      });
    }
  });

  it('returns all files when no filters', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.files).toHaveLength(3);
  });

  it('includes Cache-Control header', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: createAuthHeaders(),
    });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('disables cache with cache=false query parameter', async () => {
    const response = await SELF.fetch('http://localhost/files?cache=false', {
      headers: createAuthHeaders(),
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('filters by category', async () => {
    const response = await SELF.fetch('http://localhost/files?category=documents', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(2);
  });

  it('filters by entity', async () => {
    const response = await SELF.fetch('http://localhost/files?entity=user-2', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(1);
  });

  it('filters by extension', async () => {
    const response = await SELF.fetch('http://localhost/files?extension=pdf', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(1);
  });

  it('supports pagination with limit', async () => {
    const response = await SELF.fetch('http://localhost/files?limit=2', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.files).toHaveLength(2);
  });

  it('supports pagination with offset', async () => {
    const response = await SELF.fetch('http://localhost/files?limit=2&offset=2', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { files: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.files).toHaveLength(1);
  });

  it('groups by category', async () => {
    const response = await SELF.fetch('http://localhost/files?group_by=category', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { groups: { value: string; count: number }[]; total: number };
    expect(data.total).toBe(3);
    expect(data.groups).toHaveLength(2);
    expect(data.groups.find(g => g.value === 'documents')?.count).toBe(2);
    expect(data.groups.find(g => g.value === 'images')?.count).toBe(1);
  });

  it('rejects invalid group_by value', async () => {
    const response = await SELF.fetch('http://localhost/files?group_by=invalid', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(400);
  });
});

describe('GET /files/:id - Get file by ID', () => {
  let fileId: string;

  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validFileInput, tags: ['test-tag'] }),
    });
    const data = await response.json() as { id: string };
    fileId = data.id;
  });

  it('returns file by ID', async () => {
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { id: string; category: string; tags: string[] };
    expect(data.id).toBe(fileId);
    expect(data.category).toBe('documents');
    expect(data.tags).toContain('test-tag');
  });

  it('returns 404 for non-existent file', async () => {
    const response = await SELF.fetch('http://localhost/files/non-existent-id', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(404);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('FILE_NOT_FOUND');
  });
});

describe('PUT /files/:id - Update file', () => {
  let fileId: string;

  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
    const data = await response.json() as { id: string };
    fileId = data.id;
  });

  it('updates file fields', async () => {
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ name: 'Updated Name', category: 'updated-category' }),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { name: string; category: string };
    expect(data.name).toBe('Updated Name');
    expect(data.category).toBe('updated-category');
  });

  it('updates deprecated status', async () => {
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ deprecated: true, deprecation_reason: 'Superseded' }),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { deprecated: boolean; deprecation_reason: string };
    expect(data.deprecated).toBe(true);
    expect(data.deprecation_reason).toBe('Superseded');
  });

  it('replaces tags on update', async () => {
    // First add tags
    await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ tags: ['old-tag'] }),
    });

    // Then replace tags
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ tags: ['new-tag'] }),
    });
    const data = await response.json() as { tags: string[] };
    expect(data.tags).toEqual(['new-tag']);
  });

  it('returns 404 for non-existent file', async () => {
    const response = await SELF.fetch('http://localhost/files/non-existent-id', {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ name: 'test' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 409 for duplicate remote tuple', async () => {
    // Create another file
    await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ ...validFileInput, remote_filename: 'other.pdf' }),
    });

    // Try to update first file to have same remote tuple
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ remote_filename: 'other.pdf' }),
    });
    expect(response.status).toBe(409);
    const data = await response.json() as { error: { code: string } };
    expect(data.error.code).toBe('DUPLICATE_REMOTE_TUPLE');
  });

  it('rejects invalid update data', async () => {
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ size: -100 }),
    });
    expect(response.status).toBe(400);
  });
});

describe('DELETE /files/:id - Delete file by ID', () => {
  let fileId: string;

  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
    const data = await response.json() as { id: string };
    fileId = data.id;
  });

  it('deletes file by ID', async () => {
    const response = await SELF.fetch(`http://localhost/files/${fileId}`, {
      method: 'DELETE',
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(true);

    // Verify file is deleted
    const getResponse = await SELF.fetch(`http://localhost/files/${fileId}`, {
      headers: createAuthHeaders(),
    });
    expect(getResponse.status).toBe(404);
  });

  it('returns 404 for non-existent file', async () => {
    const response = await SELF.fetch('http://localhost/files/non-existent-id', {
      method: 'DELETE',
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /files - Delete file by remote tuple', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
  });

  it('deletes file by remote tuple', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'DELETE',
      headers: createAuthHeaders(),
      body: JSON.stringify({
        bucket: validFileInput.bucket,
        remote_path: validFileInput.remote_path,
        remote_filename: validFileInput.remote_filename,
        remote_version: validFileInput.remote_version,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(true);
  });

  it('returns 404 for non-existent remote tuple', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'DELETE',
      headers: createAuthHeaders(),
      body: JSON.stringify({
        bucket: 'non-existent-bucket',
        remote_path: '/non-existent',
        remote_filename: 'file.txt',
        remote_version: 'v1',
      }),
    });
    expect(response.status).toBe(404);
  });

  it('rejects invalid remote tuple', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'DELETE',
      headers: createAuthHeaders(),
      body: JSON.stringify({ remote_path: '' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('GET /files/index - Nested index', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    const files = [
      { ...validFileInput, entity: 'user-1', extension: 'pdf', name: 'PDF File', size: 100 },
      { ...validFileInput, entity: 'user-1', extension: 'docx', remote_filename: 'doc.docx', name: 'Doc File', size: 200 },
      { ...validFileInput, entity: 'user-2', extension: 'png', remote_filename: 'img.png', media_type: 'image/png', name: 'Image', size: 300 },
    ];

    for (const file of files) {
      await SELF.fetch('http://localhost/files', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify(file),
      });
    }
  });

  it('returns nested index grouped by entity then extension', async () => {
    const response = await SELF.fetch('http://localhost/files/index', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
    const data = await response.json() as { index: Record<string, Record<string, { name?: string; file_size?: string }>>; total: number };

    expect(data.total).toBe(3);
    expect(data.index['user-1']).toBeDefined();
    expect(data.index['user-1']['pdf']).toBeDefined();
    expect(data.index['user-1']['docx']).toBeDefined();
    expect(data.index['user-2']).toBeDefined();
    expect(data.index['user-2']['png']).toBeDefined();
  });

  it('includes file metadata in index entries', async () => {
    const response = await SELF.fetch('http://localhost/files/index', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { index: Record<string, Record<string, { name?: string; file_size?: string }>> };

    expect(data.index['user-1']['pdf'].name).toBe('PDF File');
    expect(data.index['user-1']['pdf'].file_size).toBe('100');
  });

  it('includes Cache-Control header', async () => {
    const response = await SELF.fetch('http://localhost/files/index', {
      headers: createAuthHeaders(),
    });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('disables cache with cache=false query parameter', async () => {
    const response = await SELF.fetch('http://localhost/files/index?cache=false', {
      headers: createAuthHeaders(),
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('filters index by entity', async () => {
    const response = await SELF.fetch('http://localhost/files/index?entity=user-1', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { index: Record<string, Record<string, unknown>>; total: number };

    expect(Object.keys(data.index)).toEqual(['user-1']);
    expect(data.total).toBe(2);
  });
});

describe('Tag filtering', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();

    const files = [
      { ...validFileInput, remote_filename: 'file1.pdf', tags: ['tag-a', 'tag-b'] },
      { ...validFileInput, remote_filename: 'file2.pdf', tags: ['tag-a', 'tag-c'] },
      { ...validFileInput, remote_filename: 'file3.pdf', tags: ['tag-b', 'tag-c'] },
    ];

    for (const file of files) {
      await SELF.fetch('http://localhost/files', {
        method: 'POST',
        headers: createAuthHeaders(),
        body: JSON.stringify(file),
      });
    }
  });

  it('filters by single tag', async () => {
    const response = await SELF.fetch('http://localhost/files?tags=tag-a', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { total: number };
    expect(data.total).toBe(2);
  });

  it('filters by multiple tags (AND logic)', async () => {
    const response = await SELF.fetch('http://localhost/files?tags=tag-a,tag-b', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { total: number };
    expect(data.total).toBe(1);
  });

  it('returns empty when no files match all tags', async () => {
    const response = await SELF.fetch('http://localhost/files?tags=tag-a,tag-b,tag-c', {
      headers: createAuthHeaders(),
    });
    const data = await response.json() as { total: number };
    expect(data.total).toBe(0);
  });
});

describe('D1 session middleware', () => {
  beforeEach(async () => {
    await env.D1.prepare('DELETE FROM file_tags').run();
    await env.D1.prepare('DELETE FROM files').run();
  });

  it('returns X-D1-Bookmark header after a write', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('X-D1-Bookmark')).toBeTruthy();
  });

  it('returns X-D1-Bookmark header after a read', async () => {
    const response = await SELF.fetch('http://localhost/files', {
      headers: createAuthHeaders(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-D1-Bookmark')).toBeTruthy();
  });

  it('accepts X-D1-Bookmark header from a previous response', async () => {
    // Create a file and capture the bookmark
    const createResponse = await SELF.fetch('http://localhost/files', {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(validFileInput),
    });
    const bookmark = createResponse.headers.get('X-D1-Bookmark');
    expect(bookmark).toBeTruthy();

    // Use the bookmark in a subsequent read
    const readResponse = await SELF.fetch('http://localhost/files', {
      headers: {
        ...createAuthHeaders(),
        'X-D1-Bookmark': bookmark!,
      },
    });
    expect(readResponse.status).toBe(200);
    const data = await readResponse.json() as { total: number };
    expect(data.total).toBe(1);
    expect(readResponse.headers.get('X-D1-Bookmark')).toBeTruthy();
  });
});
