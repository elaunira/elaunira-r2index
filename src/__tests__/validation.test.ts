import { describe, it, expect } from 'vitest';
import { createFileSchema, updateFileSchema, deleteByRemoteSchema, searchParamsSchema, createDownloadSchema, analyticsParamsSchema } from '../validation';

describe('createFileSchema', () => {
  const validInput = {
    bucket: 'my-bucket',
    category: 'documents',
    entity: 'user-123',
    extension: 'pdf',
    media_type: 'application/pdf',
    remote_path: '/uploads/documents',
    remote_filename: 'report.pdf',
    remote_version: 'v1',
  };

  it('accepts valid minimal input', () => {
    const result = createFileSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const input = {
      ...validInput,
      name: 'Monthly Report',
      checksum_md5: 'd41d8cd98f00b204e9800998ecf8427e',
      checksum_sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      checksum_sha512: 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
      size: 1024,
      metadata_path: '/metadata/report.json',
      extra: { author: 'John Doe', pages: 10 },
      tags: ['important', 'monthly'],
    };

    const result = createFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = createFileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty category', () => {
    const result = createFileSchema.safeParse({ ...validInput, category: '' });
    expect(result.success).toBe(false);
  });

  it('rejects category exceeding max length', () => {
    const result = createFileSchema.safeParse({ ...validInput, category: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid MD5 checksum format', () => {
    const result = createFileSchema.safeParse({ ...validInput, checksum_md5: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects MD5 checksum with wrong length', () => {
    const result = createFileSchema.safeParse({ ...validInput, checksum_md5: 'd41d8cd98f00b204' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid SHA1 checksum format', () => {
    const result = createFileSchema.safeParse({ ...validInput, checksum_sha1: 'not-hex-string' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid SHA256 checksum format', () => {
    const result = createFileSchema.safeParse({ ...validInput, checksum_sha256: 'zzzz' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid SHA512 checksum format', () => {
    const result = createFileSchema.safeParse({ ...validInput, checksum_sha512: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects negative size', () => {
    const result = createFileSchema.safeParse({ ...validInput, size: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer size', () => {
    const result = createFileSchema.safeParse({ ...validInput, size: 10.5 });
    expect(result.success).toBe(false);
  });

  it('rejects too many tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = createFileSchema.safeParse({ ...validInput, tags });
    expect(result.success).toBe(false);
  });

  it('rejects empty tag strings', () => {
    const result = createFileSchema.safeParse({ ...validInput, tags: ['valid', ''] });
    expect(result.success).toBe(false);
  });

  it('rejects tag exceeding max length', () => {
    const result = createFileSchema.safeParse({ ...validInput, tags: ['a'.repeat(51)] });
    expect(result.success).toBe(false);
  });

  it('accepts input without remote_version', () => {
    const { remote_version, ...inputWithoutVersion } = validInput;
    const result = createFileSchema.safeParse(inputWithoutVersion);
    expect(result.success).toBe(true);
  });

  it('accepts uppercase hex in checksums', () => {
    const result = createFileSchema.safeParse({
      ...validInput,
      checksum_md5: 'D41D8CD98F00B204E9800998ECF8427E',
    });
    expect(result.success).toBe(true);
  });
});

describe('updateFileSchema', () => {
  it('accepts empty object (no updates)', () => {
    const result = updateFileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with category only', () => {
    const result = updateFileSchema.safeParse({ category: 'new-category' });
    expect(result.success).toBe(true);
  });

  it('accepts deprecated and deprecation_reason', () => {
    const result = updateFileSchema.safeParse({
      deprecated: true,
      deprecation_reason: 'Superseded by newer version',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid deprecated type', () => {
    const result = updateFileSchema.safeParse({ deprecated: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects deprecation_reason exceeding max length', () => {
    const result = updateFileSchema.safeParse({ deprecation_reason: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts all updatable fields', () => {
    const result = updateFileSchema.safeParse({
      name: 'Updated Name',
      category: 'updated-category',
      entity: 'updated-entity',
      extension: 'docx',
      media_type: 'application/docx',
      remote_path: '/new/path',
      remote_filename: 'new-file.docx',
      remote_version: 'v2',
      metadata_path: '/meta/new.json',
      size: 2048,
      checksum_md5: 'a'.repeat(32),
      checksum_sha1: 'b'.repeat(40),
      checksum_sha256: 'c'.repeat(64),
      checksum_sha512: 'd'.repeat(128),
      extra: { key: 'value' },
      deprecated: false,
      deprecation_reason: '',
      tags: ['tag1'],
    });
    expect(result.success).toBe(true);
  });
});

describe('deleteByRemoteSchema', () => {
  it('accepts valid remote tuple', () => {
    const result = deleteByRemoteSchema.safeParse({
      bucket: 'my-bucket',
      remote_path: '/uploads',
      remote_filename: 'file.txt',
      remote_version: 'v1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing remote_path', () => {
    const result = deleteByRemoteSchema.safeParse({
      remote_filename: 'file.txt',
      remote_version: 'v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing remote_filename', () => {
    const result = deleteByRemoteSchema.safeParse({
      remote_path: '/uploads',
      remote_version: 'v1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing remote_version', () => {
    const result = deleteByRemoteSchema.safeParse({
      bucket: 'my-bucket',
      remote_path: '/uploads',
      remote_filename: 'file.txt',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty remote_path', () => {
    const result = deleteByRemoteSchema.safeParse({
      remote_path: '',
      remote_filename: 'file.txt',
      remote_version: 'v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects remote_path exceeding max length', () => {
    const result = deleteByRemoteSchema.safeParse({
      remote_path: '/'.repeat(501),
      remote_filename: 'file.txt',
      remote_version: 'v1',
    });
    expect(result.success).toBe(false);
  });
});

describe('searchParamsSchema', () => {
  it('accepts empty params', () => {
    const result = searchParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts all filter params', () => {
    const result = searchParamsSchema.safeParse({
      category: 'documents',
      entity: 'user-123',
      extension: 'pdf',
      media_type: 'application/pdf',
      deprecated: 'false',
      tags: 'tag1,tag2,tag3',
    });
    expect(result.success).toBe(true);
  });

  it('accepts pagination params', () => {
    const result = searchParamsSchema.safeParse({
      limit: '50',
      offset: '100',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid group_by values', () => {
    const validGroupBy = ['bucket', 'category', 'subcategory', 'entity', 'extension', 'media_type', 'deprecated'];
    for (const group_by of validGroupBy) {
      const result = searchParamsSchema.safeParse({ group_by });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid group_by value', () => {
    const result = searchParamsSchema.safeParse({ group_by: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects deprecated with invalid value', () => {
    const result = searchParamsSchema.safeParse({ deprecated: 'yes' });
    expect(result.success).toBe(false);
  });

  it('accepts deprecated as true', () => {
    const result = searchParamsSchema.safeParse({ deprecated: 'true' });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric limit', () => {
    const result = searchParamsSchema.safeParse({ limit: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric offset', () => {
    const result = searchParamsSchema.safeParse({ offset: 'xyz' });
    expect(result.success).toBe(false);
  });

  it('rejects category exceeding max length', () => {
    const result = searchParamsSchema.safeParse({ category: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects tags exceeding max length', () => {
    const result = searchParamsSchema.safeParse({ tags: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe('createDownloadSchema', () => {
  const validInput = {
    bucket: 'my-bucket',
    remote_path: '/uploads/documents',
    remote_filename: 'report.pdf',
    remote_version: 'v1',
    ip_address: '192.168.1.1',
  };

  it('accepts valid input', () => {
    const result = createDownloadSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts valid input with user_agent', () => {
    const result = createDownloadSchema.safeParse({
      ...validInput,
      user_agent: 'Mozilla/5.0 Chrome/120',
    });
    expect(result.success).toBe(true);
  });

  it('accepts input without remote_version', () => {
    const { remote_version, ...input } = validInput;
    const result = createDownloadSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects missing remote_path', () => {
    const { remote_path, ...input } = validInput;
    const result = createDownloadSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing ip_address', () => {
    const { ip_address, ...input } = validInput;
    const result = createDownloadSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts IPv6 addresses', () => {
    const result = createDownloadSchema.safeParse({
      ...validInput,
      ip_address: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ip_address exceeding max length', () => {
    const result = createDownloadSchema.safeParse({
      ...validInput,
      ip_address: 'a'.repeat(46),
    });
    expect(result.success).toBe(false);
  });

  it('rejects user_agent exceeding max length', () => {
    const result = createDownloadSchema.safeParse({
      ...validInput,
      user_agent: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('analyticsParamsSchema', () => {
  const validParams = {
    start: '1704067200000',
    end: '1706745600000',
  };

  it('accepts valid params', () => {
    const result = analyticsParamsSchema.safeParse(validParams);
    expect(result.success).toBe(true);
  });

  it('accepts all optional params', () => {
    const result = analyticsParamsSchema.safeParse({
      ...validParams,
      scale: 'day',
      remote_path: '/uploads',
      remote_filename: 'file.pdf',
      remote_version: 'v1',
      ip: '192.168.1.1',
      limit: '100',
      offset: '0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing start', () => {
    const result = analyticsParamsSchema.safeParse({ end: '1706745600000' });
    expect(result.success).toBe(false);
  });

  it('rejects missing end', () => {
    const result = analyticsParamsSchema.safeParse({ start: '1704067200000' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric start', () => {
    const result = analyticsParamsSchema.safeParse({ ...validParams, start: 'abc' });
    expect(result.success).toBe(false);
  });

  it('accepts valid scale values', () => {
    for (const scale of ['hour', 'day', 'month']) {
      const result = analyticsParamsSchema.safeParse({ ...validParams, scale });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid scale value', () => {
    const result = analyticsParamsSchema.safeParse({ ...validParams, scale: 'year' });
    expect(result.success).toBe(false);
  });

  it('rejects start greater than end', () => {
    const result = analyticsParamsSchema.safeParse({
      start: '1706745600000',
      end: '1704067200000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts start equal to end', () => {
    const result = analyticsParamsSchema.safeParse({
      start: '1704067200000',
      end: '1704067200000',
    });
    expect(result.success).toBe(true);
  });
});
