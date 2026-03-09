export interface Env {
  CACHE_MAX_AGE?: string;
  D1: D1Database;
  DOWNLOADS_RETENTION_DAYS?: string; // Days to keep download records (default: no limit)
  R2INDEX_READ_TOKEN?: string; // Optional: if empty or unset, read operations are public
  R2INDEX_WRITE_TOKEN: string;
}

export interface Variables {
  db: D1Database;
  requestId: string;
}

export interface FileRecord {
  bucket: string;
  category: string;
  subcategory: string | null;
  checksum_md5: string | null;
  checksum_sha1: string | null;
  checksum_sha256: string | null;
  checksum_sha512: string | null;
  created: number;
  deprecated: boolean;
  deprecation_reason: string;
  entity: string;
  extension: string;
  extra: Record<string, unknown> | null;
  id: string;
  media_type: string;
  metadata_path: string | null;
  name: string | null;
  remote_filename: string;
  remote_path: string;
  remote_version: string | null;
  size: number | null;
  tags?: string[];
  updated: number;
}

export interface CreateFileInput {
  bucket: string;
  category: string;
  subcategory?: string;
  checksum_md5?: string;
  checksum_sha1?: string;
  checksum_sha256?: string;
  checksum_sha512?: string;
  deprecated?: boolean;
  deprecation_reason?: string;
  entity: string;
  extension: string;
  extra?: Record<string, unknown>;
  media_type: string;
  metadata_path?: string;
  name?: string;
  remote_filename: string;
  remote_path: string;
  remote_version?: string;
  size?: number;
  tags?: string[];
}

export interface UpdateFileInput {
  bucket?: string;
  category?: string;
  subcategory?: string;
  checksum_md5?: string;
  checksum_sha1?: string;
  checksum_sha256?: string;
  checksum_sha512?: string;
  deprecated?: boolean;
  deprecation_reason?: string;
  entity?: string;
  extension?: string;
  extra?: Record<string, unknown>;
  media_type?: string;
  metadata_path?: string;
  name?: string;
  remote_filename?: string;
  remote_path?: string;
  remote_version?: string;
  size?: number;
  tags?: string[];
}

export interface SearchParams {
  bucket?: string;
  category?: string;
  subcategory?: string;
  deprecated?: string;
  entity?: string;
  extension?: string;
  group_by?: string;
  limit?: string;
  media_type?: string;
  offset?: string;
  tags?: string;
}

export interface GroupedResult {
  count: number;
  value: string;
}

export interface SearchResult {
  files: FileRecord[];
  total: number;
}

export interface GroupedSearchResult {
  groups: GroupedResult[];
  total: number;
}

export interface FileIndexEntry {
  checksums: {
    md5?: string;
    sha1?: string;
    sha256?: string;
    sha512?: string;
  };
  file_size?: string;
  last_updated?: string;
  name?: string;
  [key: string]: unknown;
}

export type NestedIndex = Record<string, Record<string, FileIndexEntry>>;

export interface NestedIndexResult {
  index: NestedIndex;
  total: number;
}

// Downloads tracking
export interface DownloadRecord {
  id: string;
  bucket: string;
  remote_path: string;
  remote_filename: string;
  remote_version: string | null;
  ip_address: string;
  user_agent: string | null;
  downloaded_at: number;
  hour_bucket: number;
  day_bucket: number;
  month_bucket: number;
}

export interface CreateDownloadInput {
  bucket: string;
  remote_path: string;
  remote_filename: string;
  remote_version?: string;
  ip_address: string;
  user_agent?: string;
}

export type AnalyticsScale = 'hour' | 'day' | 'month';

export interface AnalyticsParams {
  start: number;
  end: number;
  scale?: AnalyticsScale;
  bucket?: string;
  remote_path?: string;
  remote_filename?: string;
  remote_version?: string;
  ip?: string;
  limit?: number;
  offset?: number;
}

export interface FileDownloadStats {
  id: string | null;
  bucket: string;
  remote_path: string;
  remote_filename: string;
  remote_version: string | null;
  downloads: number;
  unique_downloads: number;
}

export interface TimeSeriesBucket {
  timestamp: number;
  files: FileDownloadStats[];
  total_downloads: number;
  total_unique_downloads: number;
}

export interface AnalyticsSummary {
  total_downloads: number;
  unique_downloads: number;
  top_user_agents: { user_agent: string; downloads: number }[];
  period: { start: number; end: number };
}

export interface DownloadsByIpResult {
  downloads: {
    bucket: string;
    remote_path: string;
    remote_filename: string;
    remote_version: string | null;
    downloaded_at: number;
    user_agent: string | null;
  }[];
  total: number;
}

export interface UserAgentStats {
  user_agent: string;
  downloads: number;
  unique_ips: number;
}
