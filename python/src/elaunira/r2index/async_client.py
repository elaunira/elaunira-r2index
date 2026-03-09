"""Asynchronous R2Index API client."""

import contextlib
import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import filetype
import httpx

from . import __version__ as _version
from .async_storage import AsyncR2Storage
from .checksums import compute_checksums_async
from .exceptions import (
    AuthenticationError,
    ChecksumVerificationError,
    ConflictError,
    NotFoundError,
    R2IndexError,
    ValidationError,
)
from .models import (
    CleanupResponse,
    DownloadRecord,
    DownloadRecordRequest,
    DownloadsByIpResponse,
    FileCreateRequest,
    FileListResponse,
    FileRecord,
    FileUpdateRequest,
    HealthResponse,
    IndexResponse,
    RemoteTuple,
    SummaryResponse,
    TimeseriesResponse,
    UserAgentsResponse,
)
from .storage import R2Config, R2TransferConfig

CHECKIP_URL = "https://checkip.amazonaws.com"
DEFAULT_USER_AGENT = f"elaunira-r2index/{_version}"

logger = logging.getLogger(__name__)


class AsyncR2IndexClient:
    """Asynchronous client for the r2index API."""

    def __init__(
        self,
        index_api_url: str,
        index_api_token: str,
        r2_access_key_id: str | None = None,
        r2_secret_access_key: str | None = None,
        r2_endpoint_url: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize the async R2Index client.

        Args:
            index_api_url: Base URL of the r2index API.
            index_api_token: Bearer token for authentication.
            r2_access_key_id: R2 access key ID for storage operations.
            r2_secret_access_key: R2 secret access key for storage operations.
            r2_endpoint_url: R2 endpoint URL for storage operations.
            timeout: Request timeout in seconds.
        """
        self.api_url = index_api_url.rstrip("/")
        self._token = index_api_token
        self._timeout = timeout
        self._storage: AsyncR2Storage | None = None

        # Build R2 config if credentials provided
        if r2_access_key_id and r2_secret_access_key and r2_endpoint_url:
            self._r2_config: R2Config | None = R2Config(
                access_key_id=r2_access_key_id,
                secret_access_key=r2_secret_access_key,
                endpoint_url=r2_endpoint_url,
            )
        else:
            self._r2_config = None

        self._client = httpx.AsyncClient(
            base_url=self.api_url,
            headers={"Authorization": f"Bearer {index_api_token}"},
            timeout=timeout,
        )

    async def __aenter__(self) -> "AsyncR2IndexClient":
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    def _get_storage(self) -> AsyncR2Storage:
        """Get or create the async R2 uploader."""
        if self._r2_config is None:
            raise R2IndexError("R2 configuration required for upload operations")
        if self._storage is None:
            self._storage = AsyncR2Storage(self._r2_config)
        return self._storage

    def _handle_response(self, response: httpx.Response) -> Any:
        """Handle API response and raise appropriate exceptions."""
        if response.status_code == 200 or response.status_code == 201:
            return response.json()

        status = response.status_code
        try:
            error_data = response.json()
            message = error_data.get("error", response.text)
        except Exception:
            message = response.text

        if status == 401 or status == 403:
            raise AuthenticationError(message, status)
        elif status == 404:
            raise NotFoundError(message, status)
        elif status == 400:
            raise ValidationError(message, status)
        elif status == 409:
            raise ConflictError(message, status)
        else:
            raise R2IndexError(message, status)

    # File Operations

    async def list_files(
        self,
        bucket: str | None = None,
        category: str | None = None,
        subcategory: str | None = None,
        entity: str | None = None,
        extension: str | None = None,
        media_type: str | None = None,
        tags: list[str] | None = None,
        deprecated: bool | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> FileListResponse:
        """
        List files with optional filters.

        Args:
            bucket: Filter by bucket.
            category: Filter by category.
            subcategory: Filter by subcategory.
            entity: Filter by entity.
            extension: Filter by file extension.
            media_type: Filter by media type.
            tags: Filter by tags.
            deprecated: Filter by deprecated status.
            limit: Maximum number of results.
            offset: Number of results to skip.

        Returns:
            FileListResponse with files and total count.
        """
        params: dict[str, Any] = {}
        if bucket:
            params["bucket"] = bucket
        if category:
            params["category"] = category
        if subcategory:
            params["subcategory"] = subcategory
        if entity:
            params["entity"] = entity
        if extension:
            params["extension"] = extension
        if media_type:
            params["media_type"] = media_type
        if tags:
            params["tags"] = ",".join(tags)
        if deprecated is not None:
            params["deprecated"] = "true" if deprecated else "false"
        if limit:
            params["limit"] = str(limit)
        if offset:
            params["offset"] = str(offset)

        response = await self._client.get("/files", params=params)
        data = self._handle_response(response)
        return FileListResponse.model_validate(data)

    async def create(self, data: FileCreateRequest) -> FileRecord:
        """
        Create or upsert a file record.

        Args:
            data: File creation request data.

        Returns:
            The created or updated FileRecord.
        """
        response = await self._client.post("/files", json=data.model_dump(exclude_none=True, by_alias=True))
        result = self._handle_response(response)
        return FileRecord.model_validate(result)

    async def get(self, file_id: str) -> FileRecord:
        """
        Get a file by ID.

        Args:
            file_id: The file ID.

        Returns:
            The FileRecord.

        Raises:
            NotFoundError: If the file is not found.
        """
        response = await self._client.get(f"/files/{file_id}")
        data = self._handle_response(response)
        return FileRecord.model_validate(data)

    async def update(self, file_id: str, data: FileUpdateRequest) -> FileRecord:
        """
        Update a file record.

        Args:
            file_id: The file ID to update.
            data: Fields to update.

        Returns:
            The updated FileRecord.
        """
        response = await self._client.put(
            f"/files/{file_id}",
            json=data.model_dump(exclude_none=True, by_alias=True),
        )
        result = self._handle_response(response)
        return FileRecord.model_validate(result)

    async def delete(self, file_id: str) -> None:
        """
        Delete a file by ID.

        Args:
            file_id: The file ID to delete.

        Raises:
            NotFoundError: If the file is not found.
        """
        response = await self._client.delete(f"/files/{file_id}")
        self._handle_response(response)

    async def delete_by_tuple(self, remote_tuple: RemoteTuple) -> None:
        """
        Delete a file by remote tuple.

        Args:
            remote_tuple: The bucket, remote path, filename, and version.

        Raises:
            NotFoundError: If the file is not found.
        """
        response = await self._client.request(
            "DELETE",
            "/files",
            json=remote_tuple.model_dump(by_alias=True),
        )
        self._handle_response(response)

    async def get_by_tuple(self, remote_tuple: RemoteTuple) -> FileRecord:
        """
        Get a file by remote tuple.

        Args:
            remote_tuple: The bucket, remote path, filename, and version.

        Returns:
            The FileRecord.

        Raises:
            NotFoundError: If the file is not found.
        """
        params = {
            k: v
            for k, v in {
                "bucket": remote_tuple.bucket,
                "remote_path": remote_tuple.remote_path,
                "remote_filename": remote_tuple.remote_filename,
                "remote_version": remote_tuple.remote_version,
            }.items()
            if v is not None
        }
        response = await self._client.get("/files/by-tuple", params=params)
        data = self._handle_response(response)
        return FileRecord.model_validate(data)

    async def index(
        self,
        bucket: str | None = None,
        category: str | None = None,
        subcategory: str | None = None,
        entity: str | None = None,
        tags: list[str] | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> IndexResponse:
        """
        Get file index (nested structure grouped by entity then extension).

        Args:
            bucket: Filter by bucket.
            category: Filter by category.
            subcategory: Filter by subcategory.
            entity: Filter by entity.
            tags: Filter by tags.
            limit: Maximum number of results (default 100, max 1000).
            offset: Number of results to skip (starts at 0).

        Returns:
            IndexResponse with nested index and total count.
        """
        params: dict[str, Any] = {}
        if bucket:
            params["bucket"] = bucket
        if category:
            params["category"] = category
        if subcategory:
            params["subcategory"] = subcategory
        if entity:
            params["entity"] = entity
        if tags:
            params["tags"] = ",".join(tags)
        if limit:
            params["limit"] = str(limit)
        if offset:
            params["offset"] = str(offset)

        response = await self._client.get("/files/index", params=params)
        data = self._handle_response(response)
        return IndexResponse.model_validate(data)

    # Download Tracking

    async def record_download(self, data: DownloadRecordRequest) -> DownloadRecord:
        """
        Record a file download.

        Args:
            data: Download record data.

        Returns:
            The created DownloadRecord.
        """
        response = await self._client.post("/downloads", json=data.model_dump(exclude_none=True, by_alias=True))
        result = self._handle_response(response)
        return DownloadRecord.model_validate(result)

    # Analytics

    async def get_timeseries(
        self,
        start: datetime,
        end: datetime,
        granularity: str = "day",
        file_id: str | None = None,
        category: str | None = None,
        entity: str | None = None,
    ) -> TimeseriesResponse:
        """
        Get download timeseries analytics.

        Args:
            start: Start datetime.
            end: End datetime.
            granularity: Time granularity (hour, day, week, month).
            file_id: Optional file ID filter.
            category: Optional category filter.
            entity: Optional entity filter.

        Returns:
            TimeseriesResponse with data points.
        """
        params: dict[str, Any] = {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "granularity": granularity,
        }
        if file_id:
            params["fileId"] = file_id
        if category:
            params["category"] = category
        if entity:
            params["entity"] = entity

        response = await self._client.get("/analytics/timeseries", params=params)
        data = self._handle_response(response)
        return TimeseriesResponse.model_validate(data)

    async def get_summary(
        self,
        start: datetime,
        end: datetime,
        file_id: str | None = None,
        category: str | None = None,
        entity: str | None = None,
    ) -> SummaryResponse:
        """
        Get download summary analytics.

        Args:
            start: Start datetime.
            end: End datetime.
            file_id: Optional file ID filter.
            category: Optional category filter.
            entity: Optional entity filter.

        Returns:
            SummaryResponse with aggregated statistics.
        """
        params: dict[str, Any] = {
            "start": start.isoformat(),
            "end": end.isoformat(),
        }
        if file_id:
            params["fileId"] = file_id
        if category:
            params["category"] = category
        if entity:
            params["entity"] = entity

        response = await self._client.get("/analytics/summary", params=params)
        data = self._handle_response(response)
        return SummaryResponse.model_validate(data)

    async def get_downloads_by_ip(
        self,
        ip_address: str,
        start: datetime,
        end: datetime,
    ) -> DownloadsByIpResponse:
        """
        Get downloads by IP address.

        Args:
            ip_address: The IP address to query.
            start: Start datetime.
            end: End datetime.

        Returns:
            DownloadsByIpResponse with download records.
        """
        params = {
            "start": start.isoformat(),
            "end": end.isoformat(),
        }
        response = await self._client.get(f"/analytics/by-ip/{ip_address}", params=params)
        data = self._handle_response(response)
        return DownloadsByIpResponse.model_validate(data)

    async def get_user_agents(
        self,
        start: datetime,
        end: datetime,
    ) -> UserAgentsResponse:
        """
        Get user agent analytics.

        Args:
            start: Start datetime.
            end: End datetime.

        Returns:
            UserAgentsResponse with user agent counts.
        """
        params = {
            "start": start.isoformat(),
            "end": end.isoformat(),
        }
        response = await self._client.get("/analytics/user-agents", params=params)
        data = self._handle_response(response)
        return UserAgentsResponse.model_validate(data)

    # Maintenance

    async def cleanup_downloads(self) -> CleanupResponse:
        """
        Clean up old download records.

        Returns:
            CleanupResponse with deleted count.
        """
        response = await self._client.post("/maintenance/cleanup-downloads")
        data = self._handle_response(response)
        return CleanupResponse.model_validate(data)

    # Health

    async def health(self) -> HealthResponse:
        """
        Check API health.

        Returns:
            HealthResponse with status and timestamp.
        """
        response = await self._client.get("/health")
        data = self._handle_response(response)
        return HealthResponse.model_validate(data)

    # High-Level Pipeline

    async def upload(
        self,
        bucket: str,
        source: str | Path,
        category: str,
        entity: str,
        destination_path: str,
        destination_filename: str,
        destination_version: str,
        content_type: str | None = None,
        create_checksum_files: bool = False,
        deprecated: bool | None = None,
        deprecation_reason: str | None = None,
        extension: str | None = None,
        extra: dict[str, Any] | None = None,
        media_type: str | None = None,
        name: str | None = None,
        progress_callback: Callable[[int], None] | None = None,
        progress_interval: float | None = 10.0,
        subcategory: str | None = None,
        tags: list[str] | None = None,
        transfer_config: R2TransferConfig | None = None,
    ) -> FileRecord:
        """
        Upload a file to R2 and register it with the r2index API asynchronously.

        This is a convenience method that performs the full pipeline:
        1. Compute checksums (streaming, memory efficient)
        2. Upload to R2 (multipart for large files)
        3. Optionally upload checksum files (.md5, .sha1, .sha256, .sha512)
        4. Register with r2index API

        Args:
            bucket: The S3/R2 bucket name.
            source: Local path to the file to upload.
            category: File category.
            entity: File entity.
            destination_path: Path in R2 (e.g., "/data/files").
            destination_filename: Filename in R2.
            destination_version: Version identifier.
            extension: File extension (e.g., "zip", "tar.gz"). If not provided,
                extracted from destination_filename.
            media_type: MIME type (e.g., "application/zip"). If not provided,
                detected from file content.
            name: Optional display name.
            tags: Optional list of tags.
            extra: Optional extra metadata.
            content_type: Optional content type for R2.
            progress_callback: Optional callback for upload progress.
            transfer_config: Optional transfer configuration for multipart/threading.
            create_checksum_files: If True, upload checksum files alongside the main
                file (e.g., file.txt.md5, file.txt.sha256).

        Returns:
            The created FileRecord.

        Raises:
            R2IndexError: If R2 config is not provided.
            UploadError: If upload fails.
            ValueError: If extension cannot be determined from filename.
        """
        source_path = Path(source)
        storage = self._get_storage()

        # Auto-detect extension from destination_filename if not provided
        if extension is None:
            if "." in destination_filename:
                extension = destination_filename.rsplit(".", 1)[1]
            else:
                raise ValueError(
                    f"Cannot determine extension from filename: {destination_filename}"
                )

        # Auto-detect media_type from file content if not provided
        if media_type is None:
            kind = filetype.guess(source_path)
            media_type = kind.mime if kind is not None else "application/octet-stream"

        # Step 1: Compute checksums
        checksums = await compute_checksums_async(source_path)

        # Step 2: Build R2 object key
        parts = [destination_path.strip('/')]
        if destination_version:
            parts.append(destination_version)
        parts.append(destination_filename)
        object_key = "/".join(parts)

        # Step 3: Upload to R2
        await storage.upload_file(
            source_path,
            bucket,
            object_key,
            content_type=content_type,
            progress_callback=progress_callback,
            transfer_config=transfer_config,
            progress_interval=progress_interval,
        )

        # Step 4: Upload checksum files if requested
        if create_checksum_files:
            checksum_files = [
                ("md5", checksums.md5),
                ("sha1", checksums.sha1),
                ("sha256", checksums.sha256),
                ("sha512", checksums.sha512),
            ]
            for ext, value in checksum_files:
                checksum_key = f"{object_key}.{ext}"
                await storage.upload_bytes(
                    f"{value}  {destination_filename}\n".encode(),
                    bucket,
                    checksum_key,
                    content_type="text/plain",
                )

        # Step 5: Register with API
        create_request = FileCreateRequest(
            bucket=bucket,
            category=category,
            subcategory=subcategory,
            entity=entity,
            extension=extension,
            media_type=media_type,
            remote_path=destination_path,
            remote_filename=destination_filename,
            remote_version=destination_version,
            name=name,
            tags=tags,
            extra=extra,
            size=checksums.size,
            checksum_md5=checksums.md5,
            checksum_sha1=checksums.sha1,
            checksum_sha256=checksums.sha256,
            checksum_sha512=checksums.sha512,
            deprecated=deprecated,
            deprecation_reason=deprecation_reason,
        )

        result = await self.create(create_request)
        logger.info(
            "Upload successful: bucket=%s, path=%s, filename=%s, version=%s",
            bucket, destination_path, destination_filename, destination_version,
        )
        return result

    async def _get_public_ip(self) -> str:
        """Fetch public IP address from checkip.amazonaws.com."""
        async with httpx.AsyncClient() as client:
            response = await client.get(CHECKIP_URL, timeout=10.0)
            return response.text.strip()

    async def download(
        self,
        bucket: str,
        source_path: str,
        source_filename: str,
        destination: str | Path,
        source_version: str | None = None,
        ip_address: str | None = None,
        overwrite: bool = True,
        progress_callback: Callable[[int], None] | None = None,
        progress_interval: float | None = 10.0,
        transfer_config: R2TransferConfig | None = None,
        user_agent: str | None = None,
        verify_checksum: bool = False,
        checksum_retries: int = 2,
    ) -> tuple[Path, FileRecord | None]:
        """
        Download a file from R2 and record the download in the index asynchronously.

        This is a convenience method that performs:
        1. Download the file from R2
        2. Fetch file record from the index (non-fatal if not found)
        3. Optionally verify file integrity using checksums (with retries)
        4. Record the download in the index for analytics

        Args:
            bucket: The S3/R2 bucket name.
            source_path: Path in R2 (e.g., "/releases/myapp").
            source_filename: Filename in R2 (e.g., "myapp.zip").
            source_version: Version identifier (e.g., "v1").
            destination: Local path where the file will be saved.
            ip_address: IP address of the downloader. If not provided, fetched
                from checkip.amazonaws.com.
            user_agent: User agent string. Defaults to "elaunira-r2index/<version>".
            progress_callback: Optional callback for download progress.
            transfer_config: Optional transfer configuration for multipart/threading.
            verify_checksum: If True, verify file integrity after download using
                SHA-256 checksum from the file record.
            checksum_retries: Number of additional download attempts if checksum
                verification fails. Defaults to 2.
            overwrite: If False, skip download when destination file already
                exists. Defaults to True.

        Returns:
            A tuple of (downloaded file path, file record or None if not indexed).

        Raises:
            R2IndexError: If R2 config is not provided.
            DownloadError: If download fails.
            ChecksumVerificationError: If checksum verification fails after all retries.
        """
        storage = self._get_storage()

        # Step 1: Build R2 object key and download
        parts = [source_path.strip('/')]
        if source_version:
            parts.append(source_version)
        parts.append(source_filename)
        object_key = "/".join(parts)
        downloaded_path = await storage.download_file(
            bucket,
            object_key,
            destination,
            progress_callback=progress_callback,
            transfer_config=transfer_config,
            progress_interval=progress_interval,
            overwrite=overwrite,
        )

        # Step 2: Fetch file record from the index (non-fatal if not found)
        remote_tuple = RemoteTuple(
            bucket=bucket,
            remote_path=source_path,
            remote_filename=source_filename,
            remote_version=source_version,
        )
        try:
            file_record = await self.get_by_tuple(remote_tuple)
        except NotFoundError:
            logger.warning(
                "File not found in index for %s/%s/%s — skipping checksum "
                "verification and download recording",
                source_path,
                source_version,
                source_filename,
            )
            return downloaded_path, None

        # Step 3: Verify checksum if requested, retrying the download on mismatch
        if verify_checksum:
            expected_checksum = file_record.checksum_sha256
            if expected_checksum:
                for attempt in range(checksum_retries + 1):
                    if attempt > 0:
                        logger.warning(
                            "Checksum mismatch for %s on attempt %d/%d, re-downloading...",
                            source_filename, attempt, checksum_retries + 1,
                        )
                        downloaded_path = await storage.download_file(
                            bucket,
                            object_key,
                            destination,
                            progress_callback=progress_callback,
                            transfer_config=transfer_config,
                            progress_interval=progress_interval,
                            overwrite=True,
                        )
                    logger.info(
                        "Verifying SHA-256 checksum for %s (attempt %d/%d)",
                        source_filename, attempt + 1, checksum_retries + 1,
                    )
                    actual_checksums = await compute_checksums_async(downloaded_path)
                    if actual_checksums.sha256 == expected_checksum:
                        logger.info("Checksum verified for %s", source_filename)
                        break
                    if attempt == checksum_retries:
                        raise ChecksumVerificationError(
                            f"SHA-256 checksum mismatch for {source_filename} after {checksum_retries + 1} attempt(s)",
                            expected=expected_checksum,
                            actual=actual_checksums.sha256,
                        )

        # Step 4: Record the download
        if ip_address is None:
            ip_address = await self._get_public_ip()
        if user_agent is None:
            user_agent = DEFAULT_USER_AGENT

        download_request = DownloadRecordRequest(
            bucket=bucket,
            remote_path=source_path,
            remote_filename=source_filename,
            remote_version=source_version,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.record_download(download_request)

        logger.info(
            "Download successful: bucket=%s, path=%s, filename=%s, version=%s",
            bucket, source_path, source_filename, source_version,
        )
        return downloaded_path, file_record

    async def delete_from_r2(
        self,
        bucket: str,
        path: str,
        filename: str,
        version: str,
        delete_checksum_files: bool = False,
    ) -> None:
        """
        Delete an object from R2 storage.

        Args:
            bucket: The S3/R2 bucket name.
            path: Path in R2 (e.g., "/releases/myapp").
            filename: Filename in R2 (e.g., "myapp.zip").
            version: Version identifier (e.g., "v1").
            delete_checksum_files: If True, also delete checksum sidecar files
                (.md5, .sha1, .sha256, .sha512) if they exist.

        Raises:
            R2IndexError: If R2 config is not provided or deletion fails.
        """
        storage = self._get_storage()
        parts = [path.strip('/')]
        if version:
            parts.append(version)
        parts.append(filename)
        object_key = "/".join(parts)
        await storage.delete_object(bucket, object_key)

        if delete_checksum_files:
            for ext in ["md5", "sha1", "sha256", "sha512"]:
                checksum_key = f"{object_key}.{ext}"
                with contextlib.suppress(Exception):
                    await storage.delete_object(bucket, checksum_key)
