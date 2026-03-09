import { env } from 'cloudflare:test';

export async function setupDatabase() {
  // Initialize database schema using batch
  await env.D1.batch([
    env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT,
        bucket TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        entity TEXT NOT NULL,
        extension TEXT NOT NULL,
        media_type TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        remote_filename TEXT NOT NULL,
        remote_version TEXT,
        metadata_path TEXT,
        size INTEGER,
        checksum_md5 TEXT,
        checksum_sha1 TEXT,
        checksum_sha256 TEXT,
        checksum_sha512 TEXT,
        extra TEXT,
        deprecated INTEGER DEFAULT 0,
        deprecation_reason TEXT DEFAULT '',
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      )
    `),
    env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS file_tags (
        file_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (file_id, tag),
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      )
    `),
    env.D1.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_files_remote_unique ON files(bucket, remote_path, remote_filename, remote_version)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_files_bucket ON files(bucket)'),
    env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS file_downloads (
        id TEXT PRIMARY KEY,
        bucket TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        remote_filename TEXT NOT NULL,
        remote_version TEXT,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        downloaded_at INTEGER NOT NULL,
        hour_bucket INTEGER NOT NULL,
        day_bucket INTEGER NOT NULL,
        month_bucket INTEGER NOT NULL
      )
    `),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_hour ON file_downloads(hour_bucket)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_day ON file_downloads(day_bucket)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_month ON file_downloads(month_bucket)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_day_file ON file_downloads(day_bucket, bucket, remote_path, remote_filename, remote_version)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_hour_file ON file_downloads(hour_bucket, bucket, remote_path, remote_filename, remote_version)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_month_file ON file_downloads(month_bucket, bucket, remote_path, remote_filename, remote_version)'),
    env.D1.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_ip_day ON file_downloads(ip_address, day_bucket)'),
  ]);
}
