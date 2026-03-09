"""Python library for uploading and downloading files to/from Cloudflare R2 with the r2index API."""

from importlib.metadata import version

__version__: str = version("elaunira-r2index")

from .async_client import AsyncR2IndexClient
from .async_storage import AsyncR2Storage
from .checksums import (
    ChecksumResult,
    compute_checksums,
    compute_checksums_async,
    compute_checksums_from_file_object,
)
from .client import R2IndexClient
from .exceptions import (
    AuthenticationError,
    ChecksumVerificationError,
    ConflictError,
    DownloadError,
    NotFoundError,
    R2IndexError,
    UploadError,
    ValidationError,
)
from .models import (
    CleanupResponse,
    DownloadByIpEntry,
    DownloadRecord,
    DownloadRecordRequest,
    DownloadsByIpResponse,
    FileCreateRequest,
    FileDownloadCountBucket,
    FileDownloadCountResponse,
    FileDownloadStats,
    FileListResponse,
    FileRecord,
    FileUpdateRequest,
    GroupedResult,
    GroupedSearchResponse,
    HealthResponse,
    IndexEntry,
    IndexResponse,
    RemoteTuple,
    SummaryResponse,
    TimeseriesBucket,
    TimeseriesResponse,
    TopFileEntry,
    TopFilesResponse,
    UserAgentDownloads,
    UserAgentEntry,
    UserAgentsResponse,
)
from .storage import R2Config, R2Storage, R2TransferConfig

__all__ = [
    # Version
    "__version__",
    # Clients
    "AsyncR2IndexClient",
    "R2IndexClient",
    # Storage
    "AsyncR2Storage",
    "R2Config",
    "R2Storage",
    "R2TransferConfig",
    # Checksums
    "ChecksumResult",
    "compute_checksums",
    "compute_checksums_async",
    "compute_checksums_from_file_object",
    # Exceptions
    "AuthenticationError",
    "ChecksumVerificationError",
    "ConflictError",
    "DownloadError",
    "NotFoundError",
    "R2IndexError",
    "UploadError",
    "ValidationError",
    # Models - File operations
    "FileCreateRequest",
    "FileListResponse",
    "FileRecord",
    "FileUpdateRequest",
    "GroupedResult",
    "GroupedSearchResponse",
    "IndexEntry",
    "IndexResponse",
    "RemoteTuple",
    # Models - Downloads
    "DownloadRecord",
    "DownloadRecordRequest",
    # Models - Analytics
    "DownloadByIpEntry",
    "DownloadsByIpResponse",
    "FileDownloadCountBucket",
    "FileDownloadCountResponse",
    "FileDownloadStats",
    "SummaryResponse",
    "TimeseriesBucket",
    "TimeseriesResponse",
    "TopFileEntry",
    "TopFilesResponse",
    "UserAgentDownloads",
    "UserAgentEntry",
    "UserAgentsResponse",
    # Models - Other
    "CleanupResponse",
    "HealthResponse",
]
