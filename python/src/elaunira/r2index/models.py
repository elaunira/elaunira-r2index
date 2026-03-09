"""Pydantic models for r2index API requests and responses."""

from typing import Any

from pydantic import BaseModel, Field


class RemoteTuple(BaseModel):
    """Remote file identifier tuple."""

    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None


class FileCreateRequest(BaseModel):
    """Request payload for creating/upserting a file record."""

    bucket: str
    category: str
    subcategory: str | None = None
    entity: str
    extension: str
    media_type: str
    remote_path: str
    remote_filename: str
    remote_version: str
    name: str | None = None
    tags: list[str] | None = None
    extra: dict[str, Any] | None = None
    metadata_path: str | None = None
    size: int | None = None
    checksum_md5: str | None = None
    checksum_sha1: str | None = None
    checksum_sha256: str | None = None
    checksum_sha512: str | None = None
    deprecated: bool | None = None
    deprecation_reason: str | None = None


class FileUpdateRequest(BaseModel):
    """Request payload for updating a file record."""

    bucket: str | None = None
    category: str | None = None
    subcategory: str | None = None
    entity: str | None = None
    extension: str | None = None
    media_type: str | None = None
    remote_path: str | None = None
    remote_filename: str | None = None
    remote_version: str | None = None
    name: str | None = None
    tags: list[str] | None = None
    extra: dict[str, Any] | None = None
    metadata_path: str | None = None
    size: int | None = None
    checksum_md5: str | None = None
    checksum_sha1: str | None = None
    checksum_sha256: str | None = None
    checksum_sha512: str | None = None
    deprecated: bool | None = None
    deprecation_reason: str | None = None


class FileRecord(BaseModel):
    """File record as returned by the API."""

    id: str
    bucket: str
    category: str
    subcategory: str | None = None
    entity: str
    extension: str
    media_type: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    name: str | None = None
    tags: list[str] = Field(default_factory=list)
    extra: dict[str, Any] | None = None
    metadata_path: str | None = None
    size: int | None = None
    checksum_md5: str | None = None
    checksum_sha1: str | None = None
    checksum_sha256: str | None = None
    checksum_sha512: str | None = None
    deprecated: bool = False
    deprecation_reason: str | None = None
    created: int  # Unix timestamp
    updated: int  # Unix timestamp


class FileListResponse(BaseModel):
    """Response for listing files."""

    files: list[FileRecord]
    total: int


class IndexEntry(BaseModel):
    """Single entry in the index response."""

    id: str
    bucket: str
    category: str
    subcategory: str | None = None
    entity: str
    extension: str
    name: str | None = None
    media_type: str
    checksums: dict[str, str | None]
    file_size: str | None = None
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    metadata_path: str | None = None
    deprecated: bool = False
    deprecation_reason: str | None = None
    tags: list[str] = Field(default_factory=list)
    extra: dict[str, Any] | None = None
    created: str | None = None
    last_updated: str | None = None


class IndexResponse(BaseModel):
    """Response for the nested index endpoint."""

    index: dict[str, dict[str, IndexEntry]]
    total: int


class GroupedResult(BaseModel):
    """Single group in a grouped search response."""

    value: str
    count: int


class GroupedSearchResponse(BaseModel):
    """Response for grouped file search (group_by)."""

    groups: list[GroupedResult]
    total: int


class DownloadRecordRequest(BaseModel):
    """Request payload for recording a download."""

    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    ip_address: str
    user_agent: str | None = None


class DownloadRecord(BaseModel):
    """Download record as returned by the API."""

    id: str
    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    ip_address: str
    user_agent: str | None = None
    downloaded_at: int  # Unix timestamp (ms)
    hour_bucket: int
    day_bucket: int
    month_bucket: int


class FileDownloadStats(BaseModel):
    """Download stats for a single file."""

    id: str | None = None
    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    downloads: int
    unique_downloads: int


class TimeseriesBucket(BaseModel):
    """Single bucket in timeseries analytics."""

    timestamp: int
    files: list[FileDownloadStats]
    total_downloads: int
    total_unique_downloads: int


class TimeseriesResponse(BaseModel):
    """Response for timeseries analytics."""

    buckets: list[TimeseriesBucket]
    period: dict[str, int]
    scale: str


class UserAgentDownloads(BaseModel):
    """User agent with download count in summary response."""

    user_agent: str
    downloads: int


class SummaryResponse(BaseModel):
    """Response for summary analytics."""

    total_downloads: int
    unique_downloads: int
    top_user_agents: list[UserAgentDownloads]
    period: dict[str, int]


class DownloadByIpEntry(BaseModel):
    """Single download entry for by-IP analytics."""

    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    downloaded_at: int
    user_agent: str | None = None


class DownloadsByIpResponse(BaseModel):
    """Response for downloads by IP analytics."""

    downloads: list[DownloadByIpEntry]
    total: int


class UserAgentEntry(BaseModel):
    """Single user agent entry in analytics."""

    user_agent: str
    downloads: int
    unique_ips: int


class UserAgentsResponse(BaseModel):
    """Response for user agents analytics."""

    user_agents: list[UserAgentEntry]
    period: dict[str, int]


class TopFileEntry(BaseModel):
    """Single file entry in top files response."""

    id: str | None = None
    bucket: str
    remote_path: str
    remote_filename: str
    remote_version: str | None = None
    downloads: int
    unique_downloads: int


class TopFilesResponse(BaseModel):
    """Response for top files by downloads."""

    files: list[TopFileEntry]
    total: int
    period: dict[str, int]


class FileDownloadCountBucket(BaseModel):
    """Single time bucket for per-file download counts."""

    timestamp: int
    downloads: int
    unique_downloads: int


class FileDownloadCountResponse(BaseModel):
    """Response for per-file download counts."""

    file_id: str
    buckets: list[FileDownloadCountBucket]
    total_downloads: int
    total_unique_downloads: int
    period: dict[str, int]
    scale: str


class CleanupResponse(BaseModel):
    """Response for cleanup operations."""

    deleted_count: int
    retention_days: int


class HealthResponse(BaseModel):
    """Response for health check."""

    status: str
