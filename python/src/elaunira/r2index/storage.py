"""Synchronous R2 storage operations using boto3."""

import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig

from .exceptions import DownloadError, UploadError

logger = logging.getLogger(__name__)

# Default thresholds and part sizes for multipart transfers.
#
# Targets are tuned for multi-Gbps links (8 Gbps reference): per-connection R2
# throughput typically lands in the 50–150 MB/s range, so saturating 1 GB/s
# (8 Gbps) requires on the order of 8–20 concurrent streams. Default
# concurrency therefore floors at 16 (and scales with CPU). Chunks of 32 MB
# strike a balance between part count (3 200 parts for a 100 GB object — well
# under S3's 10 000-part ceiling) and per-part HTTP overhead, while exposing
# enough work to keep the concurrency wheel turning during the long tail of an
# upload. Both knobs can still be overridden per call via R2TransferConfig.
DEFAULT_MULTIPART_CHUNKSIZE = 32 * 1024 * 1024  # 32MB
DEFAULT_MULTIPART_THRESHOLD = 32 * 1024 * 1024  # 32MB
DEFAULT_MIN_CONCURRENCY = 16


def _default_max_concurrency() -> int:
    """Return default max concurrency: 2x CPU cores, minimum 16.

    Sized so a single worker can fill a multi-Gbps link without manual
    tuning. On low-CPU workers the floor kicks in; on fat machines the
    2x-CPU scaling dominates.
    """
    cpu_count = os.cpu_count() or 2
    return max(DEFAULT_MIN_CONCURRENCY, cpu_count * 2)


@dataclass
class R2TransferConfig:
    """Configuration for R2 transfer operations (uploads/downloads)."""

    multipart_threshold: int = DEFAULT_MULTIPART_THRESHOLD
    """Size threshold (bytes) to trigger multipart transfer. Default 32MB."""

    multipart_chunksize: int = DEFAULT_MULTIPART_CHUNKSIZE
    """Size of each part (bytes) in multipart transfer. Default 32MB."""

    max_concurrency: int = field(default_factory=_default_max_concurrency)
    """Number of parallel threads for multipart transfer.

    Default ``max(16, 2 * CPU cores)``. The 16-stream floor is calibrated to
    saturate an 8 Gbps link (≈1 GB/s) against R2's typical per-connection
    throughput; the ``max_pool_connections`` of the underlying HTTP client is
    sized to match so the pool never becomes a hidden cap.
    """

    use_threads: bool = True
    """Whether to use threads for parallel transfer. Default True."""


@dataclass
class R2Config:
    """Configuration for R2 storage."""

    access_key_id: str
    endpoint_url: str
    secret_access_key: str
    region: str = "auto"


class R2Storage:
    """Synchronous R2 storage client using boto3."""

    def __init__(self, config: R2Config) -> None:
        """
        Initialize the R2 storage client.

        Args:
            config: R2 configuration with credentials and endpoint.
        """
        self.config = config
        self._client = boto3.client(
            "s3",
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            endpoint_url=config.endpoint_url,
            region_name=config.region,
        )

    def upload_file(
        self,
        file_path: str | Path,
        bucket: str,
        object_key: str,
        content_type: str | None = None,
        progress_callback: Callable[[int], None] | None = None,
        progress_interval: float | None = 10.0,
        transfer_config: R2TransferConfig | None = None,
    ) -> str:
        """
        Upload a file to R2.

        Uses multipart upload for files larger than the configured threshold.

        Args:
            file_path: Path to the file to upload.
            bucket: The R2 bucket name.
            object_key: The key (path) to store the object under in R2.
            content_type: Optional content type for the object.
            progress_callback: Optional callback called with bytes uploaded so far.
            transfer_config: Optional transfer configuration for multipart/threading.

        Returns:
            The object key of the uploaded file.

        Raises:
            UploadError: If the upload fails.
        """
        file_path = Path(file_path)

        if not file_path.exists():
            raise UploadError(f"File not found: {file_path}")

        tc = transfer_config or R2TransferConfig()
        logger.info(
            "Upload transfer config: threshold=%d, chunksize=%d, concurrency=%d, threads=%s",
            tc.multipart_threshold, tc.multipart_chunksize, tc.max_concurrency, tc.use_threads,
        )
        boto_transfer_config = TransferConfig(
            multipart_threshold=tc.multipart_threshold,
            multipart_chunksize=tc.multipart_chunksize,
            max_concurrency=tc.max_concurrency,
            use_threads=tc.use_threads,
        )

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        callback = None
        if progress_callback or progress_interval is not None:
            total_size = file_path.stat().st_size
            callback = _ProgressCallback(
                progress_callback,
                total_size=total_size,
                progress_interval=progress_interval,
                operation="Uploading",
            )

        try:
            self._client.upload_file(
                str(file_path),
                bucket,
                object_key,
                Config=boto_transfer_config,
                ExtraArgs=extra_args if extra_args else None,
                Callback=callback,
            )
            if callback:
                callback.finish()
        except Exception as e:
            raise UploadError(f"Failed to upload file to R2: {e}") from e

        return object_key

    def delete_object(self, bucket: str, object_key: str) -> None:
        """
        Delete an object from R2.

        Args:
            bucket: The R2 bucket name.
            object_key: The key of the object to delete.

        Raises:
            UploadError: If the deletion fails.
        """
        try:
            self._client.delete_object(Bucket=bucket, Key=object_key)
        except Exception as e:
            raise UploadError(f"Failed to delete object from R2: {e}") from e

    def upload_bytes(
        self,
        data: bytes,
        bucket: str,
        object_key: str,
        content_type: str | None = None,
    ) -> str:
        """
        Upload bytes directly to R2.

        Args:
            data: The bytes to upload.
            bucket: The R2 bucket name.
            object_key: The key (path) to store the object under in R2.
            content_type: Optional content type for the object.

        Returns:
            The object key of the uploaded data.

        Raises:
            UploadError: If the upload fails.
        """
        try:
            if content_type:
                self._client.put_object(
                    Bucket=bucket,
                    Key=object_key,
                    Body=data,
                    ContentType=content_type,
                )
            else:
                self._client.put_object(
                    Bucket=bucket,
                    Key=object_key,
                    Body=data,
                )
        except Exception as e:
            raise UploadError(f"Failed to upload bytes to R2: {e}") from e

        return object_key

    def object_exists(self, bucket: str, object_key: str) -> bool:
        """
        Check if an object exists in R2.

        Args:
            bucket: The R2 bucket name.
            object_key: The key of the object to check.

        Returns:
            True if the object exists, False otherwise.
        """
        try:
            self._client.head_object(Bucket=bucket, Key=object_key)
            return True
        except self._client.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "404":
                return False
            raise UploadError(f"Failed to check object existence: {e}") from e

    def download_file(
        self,
        bucket: str,
        object_key: str,
        file_path: str | Path,
        overwrite: bool = True,
        progress_callback: Callable[[int], None] | None = None,
        progress_interval: float | None = 10.0,
        transfer_config: R2TransferConfig | None = None,
    ) -> Path:
        """
        Download a file from R2.

        Args:
            bucket: The R2 bucket name.
            object_key: The key (path) of the object in R2.
            file_path: Local path where the file will be saved.
            progress_callback: Optional callback called with bytes downloaded so far.
            transfer_config: Optional transfer configuration for multipart/threading.

        Returns:
            The path to the downloaded file.

        Raises:
            DownloadError: If the download fails.
        """
        file_path = Path(file_path)

        if not overwrite and file_path.exists():
            logger.info("Skipping download, file already exists: %s", file_path)
            return file_path

        # Ensure parent directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)

        tc = transfer_config or R2TransferConfig()
        logger.info(
            "Download transfer config: threshold=%d, chunksize=%d, concurrency=%d, threads=%s",
            tc.multipart_threshold, tc.multipart_chunksize, tc.max_concurrency, tc.use_threads,
        )
        boto_transfer_config = TransferConfig(
            multipart_threshold=tc.multipart_threshold,
            multipart_chunksize=tc.multipart_chunksize,
            max_concurrency=tc.max_concurrency,
            use_threads=tc.use_threads,
        )

        callback = None
        if progress_callback or progress_interval is not None:
            total_size = None
            try:
                head = self._client.head_object(Bucket=bucket, Key=object_key)
                total_size = head.get("ContentLength")
            except Exception:
                pass
            callback = _ProgressCallback(
                progress_callback,
                total_size=total_size,
                progress_interval=progress_interval,
                operation="Downloading",
            )

        try:
            self._client.download_file(
                bucket,
                object_key,
                str(file_path),
                Config=boto_transfer_config,
                Callback=callback,
            )
            if callback:
                callback.finish()
        except Exception as e:
            raise DownloadError(f"Failed to download file from R2: {e}") from e

        return file_path


class _ProgressCallback:
    """Wrapper to track cumulative progress for boto3 callback."""

    def __init__(
        self,
        callback: Callable[[int], None] | None,
        total_size: int | None = None,
        progress_interval: float | None = None,
        operation: str = "Transferring",
    ) -> None:
        self._callback = callback
        self._bytes_transferred = 0
        self._total_size = total_size
        self._progress_interval = progress_interval
        self._operation = operation
        self._last_log_time = time.monotonic()
        self._start_time = time.monotonic()

    def __call__(self, bytes_amount: int) -> None:
        self._bytes_transferred += bytes_amount
        if self._callback:
            self._callback(self._bytes_transferred)
        if self._progress_interval is not None:
            now = time.monotonic()
            if now - self._last_log_time >= self._progress_interval:
                self._log_progress(now)
                self._last_log_time = now

    def finish(self) -> None:
        """Log final progress unconditionally."""
        self._log_progress(time.monotonic())

    def _log_progress(self, now: float) -> None:
        elapsed = now - self._start_time
        speed = self._bytes_transferred / elapsed if elapsed > 0 else 0
        transferred = _format_bytes(self._bytes_transferred)
        speed_str = _format_bytes(speed)
        if self._total_size is not None and self._total_size > 0:
            total = _format_bytes(self._total_size)
            pct = self._bytes_transferred / self._total_size * 100
            logger.info("%s: %s / %s (%.1f%%) — %s/s", self._operation, transferred, total, pct, speed_str)
        else:
            logger.info("%s: %s — %s/s", self._operation, transferred, speed_str)


def _format_bytes(size: float) -> str:
    """Format a byte count as a human-readable string."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(size) < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} PB"
