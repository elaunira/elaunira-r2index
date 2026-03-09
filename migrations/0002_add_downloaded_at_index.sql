-- Migration number: 0002
-- Add missing index on downloaded_at for range queries

CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON file_downloads(downloaded_at);
