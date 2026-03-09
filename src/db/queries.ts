import type { FileRecord, CreateFileInput, UpdateFileInput, SearchParams, SearchResult, GroupedSearchResult, GroupedResult, NestedIndex, NestedIndexResult } from '../types';

// ============================================================================
// Types
// ============================================================================

interface FileRecordRaw extends Omit<FileRecord, 'extra' | 'deprecated'> {
  extra: string | null;
  deprecated: number;
}

interface QueryConditions {
  conditions: string[];
  values: unknown[];
  whereClause: string;
}

// ============================================================================
// Helpers
// ============================================================================

function parseRecord(file: FileRecordRaw): FileRecord {
  return {
    ...file,
    extra: file.extra ? JSON.parse(file.extra) : null,
    deprecated: file.deprecated === 1,
  };
}

function buildSearchConditions(params: SearchParams): QueryConditions {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.bucket) { conditions.push('f.bucket = ?'); values.push(params.bucket); }
  if (params.category) { conditions.push('f.category = ?'); values.push(params.category); }
  if (params.subcategory) { conditions.push('f.subcategory = ?'); values.push(params.subcategory); }
  if (params.entity) { conditions.push('f.entity = ?'); values.push(params.entity); }
  if (params.extension) { conditions.push('f.extension = ?'); values.push(params.extension); }
  if (params.media_type) { conditions.push('f.media_type = ?'); values.push(params.media_type); }
  if (params.deprecated !== undefined) {
    conditions.push('f.deprecated = ?');
    values.push(params.deprecated === 'true' ? 1 : 0);
  }

  if (params.tags) {
    const tagList = params.tags.split(',').map(t => t.trim());
    const placeholders = tagList.map(() => '?').join(', ');
    conditions.push(`f.id IN (
      SELECT file_id FROM file_tags
      WHERE tag IN (${placeholders})
      GROUP BY file_id
      HAVING COUNT(DISTINCT tag) = ?
    )`);
    values.push(...tagList, tagList.length);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  return { conditions, values, whereClause };
}

async function setFileTags(db: D1Database, fileId: string, tags: string[] | undefined, replace = false): Promise<void> {
  if (tags === undefined) return;

  if (replace) {
    await db.prepare('DELETE FROM file_tags WHERE file_id = ?').bind(fileId).run();
  }

  if (tags.length > 0) {
    const stmt = db.prepare('INSERT INTO file_tags (file_id, tag) VALUES (?, ?)');
    await db.batch(tags.map(tag => stmt.bind(fileId, tag)));
  }
}

async function fetchTagsForFiles(db: D1Database, files: FileRecord[]): Promise<void> {
  if (files.length === 0) return;

  const BATCH_SIZE = 100;
  const fileIds = files.map(f => f.id);
  const statements = [];

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    statements.push(
      db.prepare(`SELECT file_id, tag FROM file_tags WHERE file_id IN (${placeholders})`).bind(...batch)
    );
  }

  const results = await db.batch<{ file_id: string; tag: string }>(statements);
  const tagsByFile = new Map<string, string[]>();

  for (const result of results) {
    for (const row of result.results) {
      if (!tagsByFile.has(row.file_id)) tagsByFile.set(row.file_id, []);
      tagsByFile.get(row.file_id)!.push(row.tag);
    }
  }

  for (const file of files) {
    file.tags = tagsByFile.get(file.id) ?? [];
  }
}

function buildFileEntry(file: FileRecord): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: file.id,
    bucket: file.bucket,
    category: file.category,
    subcategory: file.subcategory,
    entity: file.entity,
    extension: file.extension,
    name: file.name,
    media_type: file.media_type,
    checksums: {
      ...(file.checksum_md5 && { md5: file.checksum_md5 }),
      ...(file.checksum_sha1 && { sha1: file.checksum_sha1 }),
      ...(file.checksum_sha256 && { sha256: file.checksum_sha256 }),
      ...(file.checksum_sha512 && { sha512: file.checksum_sha512 }),
    },
    file_size: file.size !== null ? String(file.size) : null,
    remote_path: file.remote_path,
    remote_filename: file.remote_filename,
    remote_version: file.remote_version,
    metadata_path: file.metadata_path,
    deprecated: file.deprecated,
    deprecation_reason: file.deprecation_reason,
    tags: file.tags ?? [],
    extra: file.extra,
    created: file.created ? new Date(file.created).toISOString() : null,
    last_updated: file.updated ? new Date(file.updated).toISOString() : null,
  };

  return entry;
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function getFileById(db: D1Database, id: string): Promise<FileRecord | null> {
  const raw = await db.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<FileRecordRaw>();
  if (!raw) return null;

  const file = parseRecord(raw);
  const tags = await db.prepare('SELECT tag FROM file_tags WHERE file_id = ?').bind(id).all<{ tag: string }>();
  file.tags = tags.results.map(t => t.tag);

  return file;
}

export async function getFileByRemote(
  db: D1Database,
  bucket: string,
  remotePath: string,
  remoteFilename: string,
  remoteVersion?: string
): Promise<FileRecord | null> {
  let query = 'SELECT * FROM files WHERE bucket = ? AND remote_path = ? AND remote_filename = ?';
  const bindings: string[] = [bucket, remotePath, remoteFilename];

  if (remoteVersion) {
    query += ' AND remote_version = ?';
    bindings.push(remoteVersion);
  } else {
    query += ' AND remote_version IS NULL';
  }

  const raw = await db.prepare(query).bind(...bindings).first<FileRecordRaw>();

  if (!raw) return null;

  const file = parseRecord(raw);
  const tags = await db.prepare('SELECT tag FROM file_tags WHERE file_id = ?').bind(file.id).all<{ tag: string }>();
  file.tags = tags.results.map(t => t.tag);

  return file;
}

export async function createFile(db: D1Database, input: CreateFileInput): Promise<FileRecord> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`
    INSERT INTO files (id, name, bucket, category, subcategory, entity, extension, media_type, remote_path, remote_filename, remote_version, metadata_path, size, checksum_md5, checksum_sha1, checksum_sha256, checksum_sha512, extra, deprecated, deprecation_reason, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.name ?? null,
    input.bucket,
    input.category,
    input.subcategory ?? null,
    input.entity,
    input.extension,
    input.media_type,
    input.remote_path,
    input.remote_filename,
    input.remote_version ?? null,
    input.metadata_path ?? null,
    input.size ?? null,
    input.checksum_md5 ?? null,
    input.checksum_sha1 ?? null,
    input.checksum_sha256 ?? null,
    input.checksum_sha512 ?? null,
    input.extra ? JSON.stringify(input.extra) : null,
    input.deprecated ? 1 : 0,
    input.deprecation_reason ?? null,
    now,
    now
  ).run();

  await setFileTags(db, id, input.tags);

  return getFileById(db, id) as Promise<FileRecord>;
}

export async function updateFile(db: D1Database, id: string, input: UpdateFileInput): Promise<FileRecord | null> {
  const existing = await getFileById(db, id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  const fields: [keyof UpdateFileInput, string, (v: unknown) => unknown][] = [
    ['name', 'name = ?', v => v],
    ['bucket', 'bucket = ?', v => v],
    ['category', 'category = ?', v => v],
    ['subcategory', 'subcategory = ?', v => v],
    ['entity', 'entity = ?', v => v],
    ['extension', 'extension = ?', v => v],
    ['media_type', 'media_type = ?', v => v],
    ['remote_path', 'remote_path = ?', v => v],
    ['remote_filename', 'remote_filename = ?', v => v],
    ['remote_version', 'remote_version = ?', v => v],
    ['metadata_path', 'metadata_path = ?', v => v],
    ['size', 'size = ?', v => v],
    ['checksum_md5', 'checksum_md5 = ?', v => v],
    ['checksum_sha1', 'checksum_sha1 = ?', v => v],
    ['checksum_sha256', 'checksum_sha256 = ?', v => v],
    ['checksum_sha512', 'checksum_sha512 = ?', v => v],
    ['extra', 'extra = ?', v => JSON.stringify(v)],
    ['deprecated', 'deprecated = ?', v => v ? 1 : 0],
    ['deprecation_reason', 'deprecation_reason = ?', v => v],
  ];

  for (const [key, sql, transform] of fields) {
    if (input[key] !== undefined) {
      updates.push(sql);
      values.push(transform(input[key]));
    }
  }

  updates.push('updated = ?');
  values.push(Date.now());
  values.push(id);

  await db.prepare(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  await setFileTags(db, id, input.tags, true);

  return getFileById(db, id);
}

export async function deleteFile(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function deleteFileByRemote(db: D1Database, bucket: string, remotePath: string, remoteFilename: string, remoteVersion?: string): Promise<boolean> {
  let query = 'DELETE FROM files WHERE bucket = ? AND remote_path = ? AND remote_filename = ?';
  const bindings: string[] = [bucket, remotePath, remoteFilename];

  if (remoteVersion) {
    query += ' AND remote_version = ?';
    bindings.push(remoteVersion);
  } else {
    query += ' AND remote_version IS NULL';
  }

  const result = await db.prepare(query).bind(...bindings).run();
  return result.meta.changes > 0;
}

export async function upsertFile(db: D1Database, input: CreateFileInput): Promise<{ file: FileRecord; created: boolean }> {
  let upsertQuery = 'SELECT id FROM files WHERE bucket = ? AND remote_path = ? AND remote_filename = ?';
  const upsertBindings: (string | undefined)[] = [input.bucket, input.remote_path, input.remote_filename];

  if (input.remote_version) {
    upsertQuery += ' AND remote_version = ?';
    upsertBindings.push(input.remote_version);
  } else {
    upsertQuery += ' AND remote_version IS NULL';
  }

  const existing = await db.prepare(upsertQuery).bind(...upsertBindings).first<{ id: string }>();

  if (existing) {
    const now = Date.now();
    await db.prepare(`
      UPDATE files SET
        name = ?, category = ?, subcategory = ?, entity = ?, extension = ?, media_type = ?, metadata_path = ?, size = ?,
        checksum_md5 = ?, checksum_sha1 = ?, checksum_sha256 = ?, checksum_sha512 = ?, extra = ?,
        deprecated = ?, deprecation_reason = ?, updated = ?
      WHERE id = ?
    `).bind(
      input.name ?? null,
      input.category,
      input.subcategory ?? null,
      input.entity,
      input.extension,
      input.media_type,
      input.metadata_path ?? null,
      input.size ?? null,
      input.checksum_md5 ?? null,
      input.checksum_sha1 ?? null,
      input.checksum_sha256 ?? null,
      input.checksum_sha512 ?? null,
      input.extra ? JSON.stringify(input.extra) : null,
      input.deprecated ? 1 : 0,
      input.deprecation_reason ?? null,
      now,
      existing.id
    ).run();

    await setFileTags(db, existing.id, input.tags, true);

    const file = await getFileById(db, existing.id) as FileRecord;
    return { file, created: false };
  }

  const file = await createFile(db, input);
  return { file, created: true };
}

// ============================================================================
// Search Operations
// ============================================================================

const GROUPABLE_FIELDS = ['bucket', 'category', 'subcategory', 'entity', 'extension', 'media_type', 'deprecated'] as const;

export async function searchFiles(db: D1Database, params: SearchParams): Promise<SearchResult | GroupedSearchResult> {
  if (params.group_by) {
    return searchFilesGrouped(db, params);
  }
  return searchFilesList(db, params);
}

async function searchFilesGrouped(db: D1Database, params: SearchParams): Promise<GroupedSearchResult> {
  const groupBy = params.group_by as string;

  if (!GROUPABLE_FIELDS.includes(groupBy as typeof GROUPABLE_FIELDS[number])) {
    throw new Error(`Invalid group_by field: ${groupBy}`);
  }

  const { values, whereClause } = buildSearchConditions(params);
  const query = `SELECT f.${groupBy} as value, COUNT(*) as count FROM files f${whereClause} GROUP BY f.${groupBy} ORDER BY count DESC`;
  const result = await db.prepare(query).bind(...values).all<{ value: string | number; count: number }>();

  const groups: GroupedResult[] = result.results.map(r => ({
    value: groupBy === 'deprecated' ? (r.value === 1 ? 'true' : 'false') : String(r.value),
    count: r.count,
  }));

  return { groups, total: groups.reduce((sum, g) => sum + g.count, 0) };
}

async function searchFilesList(db: D1Database, params: SearchParams): Promise<SearchResult> {
  const { values, whereClause } = buildSearchConditions(params);

  const countResult = await db.prepare(`SELECT COUNT(f.id) as total FROM files f${whereClause}`).bind(...values).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const limit = Math.min(parseInt(params.limit ?? '100', 10), 1000);
  const offset = parseInt(params.offset ?? '0', 10);

  const query = `SELECT f.* FROM files f${whereClause} ORDER BY f.created DESC LIMIT ? OFFSET ?`;
  const result = await db.prepare(query).bind(...values, limit, offset).all<FileRecordRaw>();
  const files = result.results.map(parseRecord);

  await fetchTagsForFiles(db, files);

  return { files, total };
}

export async function getNestedIndex(db: D1Database, params: SearchParams): Promise<NestedIndexResult> {
  const { values, whereClause } = buildSearchConditions(params);

  const countResult = await db.prepare(`SELECT COUNT(f.id) as total FROM files f${whereClause}`).bind(...values).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const limit = Math.min(parseInt(params.limit ?? '100', 10), 1000);
  const offset = parseInt(params.offset ?? '0', 10);

  const query = `SELECT f.* FROM files f${whereClause} ORDER BY f.entity, f.extension LIMIT ? OFFSET ?`;
  const result = await db.prepare(query).bind(...values, limit, offset).all<FileRecordRaw>();
  const files = result.results.map(parseRecord);

  await fetchTagsForFiles(db, files);

  const index: NestedIndex = {};
  for (const file of files) {
    if (!index[file.entity]) {
      index[file.entity] = {};
    }
    index[file.entity][file.extension] = buildFileEntry(file) as NestedIndex[string][string];
  }

  return { index, total };
}
