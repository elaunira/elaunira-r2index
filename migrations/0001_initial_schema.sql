-- Migration number: 0001 	 2026-03-09T14:36:53.717Z
-- Initial schema

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
    deprecation_reason TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_tags (
    file_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (file_id, tag),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_subcategory ON files(subcategory);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity);
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
CREATE INDEX IF NOT EXISTS idx_files_media_type ON files(media_type);
CREATE INDEX IF NOT EXISTS idx_files_bucket ON files(bucket);
CREATE INDEX IF NOT EXISTS idx_files_deprecated ON files(deprecated);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_remote_unique ON files(bucket, remote_path, remote_filename, remote_version);
CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);

-- Downloads tracking
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
);

-- Time bucket indexes for range queries
CREATE INDEX IF NOT EXISTS idx_downloads_hour ON file_downloads(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_downloads_day ON file_downloads(day_bucket);
CREATE INDEX IF NOT EXISTS idx_downloads_month ON file_downloads(month_bucket);

-- Composite indexes for GROUP BY patterns (time bucket first for range scan, then grouping columns)
CREATE INDEX IF NOT EXISTS idx_downloads_day_file ON file_downloads(day_bucket, bucket, remote_path, remote_filename, remote_version);
CREATE INDEX IF NOT EXISTS idx_downloads_hour_file ON file_downloads(hour_bucket, bucket, remote_path, remote_filename, remote_version);
CREATE INDEX IF NOT EXISTS idx_downloads_month_file ON file_downloads(month_bucket, bucket, remote_path, remote_filename, remote_version);

-- Per-file lookup indexes (remote tuple first, then time bucket for range scan)
CREATE INDEX IF NOT EXISTS idx_downloads_file_day ON file_downloads(bucket, remote_path, remote_filename, remote_version, day_bucket);
CREATE INDEX IF NOT EXISTS idx_downloads_file_hour ON file_downloads(bucket, remote_path, remote_filename, remote_version, hour_bucket);
CREATE INDEX IF NOT EXISTS idx_downloads_file_month ON file_downloads(bucket, remote_path, remote_filename, remote_version, month_bucket);

-- IP search index
CREATE INDEX IF NOT EXISTS idx_downloads_ip_day ON file_downloads(ip_address, day_bucket);
