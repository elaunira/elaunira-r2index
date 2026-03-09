"""Asynchronous R2 storage operations using aioboto3."""

import logging
import time
from collections.abc import Callable
from pathlib import Path

import aioboto3
from aiobotocore.config import AioConfig
from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError

from .exceptions import DownloadError, UploadError
from .storage import R2Config, R2TransferConfig, _format_bytes

logger = logging.getLogger(__name__)


class AsyncR2Storage:
    """Asynchronous R2 storage client using aioboto3."""

    def __init__(self, config: R2Config) -> None:
        """
        Initialize the async R2 storage client.

        Args:
            config: R2 configuration with credentials and endpoint.
        """
        self.config = config
        self._session = aioboto3.Session()

    async def upload_file(
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
        Upload a file to R2 asynchronously.

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
            "Upload transfer config: threshold=%d, chunksize=%d, concurrency=%d",
            tc.multipart_threshold, tc.multipart_chunksize, tc.max_concurrency,
        )
        s3_transfer_config = TransferConfig(
            multipart_threshold=tc.multipart_threshold,
            multipart_chunksize=tc.multipart_chunksize,
            max_concurrency=tc.max_concurrency,
        )
        aio_config = AioConfig(
            max_pool_connections=tc.max_concurrency,
        )

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        try:
            async with self._session.client(
                "s3",
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                endpoint_url=self.config.endpoint_url,
                region_name=self.config.region,
                config=aio_config,
            ) as client:
                callback = None
                if progress_callback or progress_interval is not None:
                    total_size = file_path.stat().st_size
                    callback = _AsyncProgressCallback(
                        progress_callback,
                        total_size=total_size,
                        progress_interval=progress_interval,
                        operation="Uploading",
                    )

                await client.upload_file(
                    str(file_path),
                    bucket,
                    object_key,
                    ExtraArgs=extra_args if extra_args else None,
                    Callback=callback,
                    Config=s3_transfer_config,
                )
                if callback:
                    callback.finish()
        except Exception as e:
            raise UploadError(f"Failed to upload file to R2: {e}") from e

        return object_key

    async def delete_object(self, bucket: str, object_key: str) -> None:
        """
        Delete an object from R2 asynchronously.

        Args:
            bucket: The R2 bucket name.
            object_key: The key of the object to delete.

        Raises:
            UploadError: If the deletion fails.
        """
        try:
            async with self._session.client(
                "s3",
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                endpoint_url=self.config.endpoint_url,
                region_name=self.config.region,
            ) as client:
                await client.delete_object(Bucket=bucket, Key=object_key)
        except Exception as e:
            raise UploadError(f"Failed to delete object from R2: {e}") from e

    async def upload_bytes(
        self,
        data: bytes,
        bucket: str,
        object_key: str,
        content_type: str | None = None,
    ) -> str:
        """
        Upload bytes directly to R2 asynchronously.

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
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        try:
            async with self._session.client(
                "s3",
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                endpoint_url=self.config.endpoint_url,
                region_name=self.config.region,
            ) as client:
                await client.put_object(
                    Bucket=bucket,
                    Key=object_key,
                    Body=data,
                    **extra_args,
                )
        except Exception as e:
            raise UploadError(f"Failed to upload bytes to R2: {e}") from e

        return object_key

    async def object_exists(self, bucket: str, object_key: str) -> bool:
        """
        Check if an object exists in R2 asynchronously.

        Args:
            bucket: The R2 bucket name.
            object_key: The key of the object to check.

        Returns:
            True if the object exists, False otherwise.
        """
        try:
            async with self._session.client(
                "s3",
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                endpoint_url=self.config.endpoint_url,
                region_name=self.config.region,
            ) as client:
                await client.head_object(Bucket=bucket, Key=object_key)
                return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "404":
                return False
            raise UploadError(f"Failed to check object existence: {e}") from e

    async def download_file(
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
        Download a file from R2 asynchronously.

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
            "Download transfer config: threshold=%d, chunksize=%d, concurrency=%d",
            tc.multipart_threshold, tc.multipart_chunksize, tc.max_concurrency,
        )
        s3_transfer_config = TransferConfig(
            multipart_threshold=tc.multipart_threshold,
            multipart_chunksize=tc.multipart_chunksize,
            max_concurrency=tc.max_concurrency,
        )
        aio_config = AioConfig(
            max_pool_connections=tc.max_concurrency,
        )

        try:
            async with self._session.client(
                "s3",
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                endpoint_url=self.config.endpoint_url,
                region_name=self.config.region,
                config=aio_config,
            ) as client:
                callback = None
                if progress_callback or progress_interval is not None:
                    total_size = None
                    try:
                        head = await client.head_object(Bucket=bucket, Key=object_key)
                        total_size = head.get("ContentLength")
                    except Exception:
                        pass
                    callback = _AsyncProgressCallback(
                        progress_callback,
                        total_size=total_size,
                        progress_interval=progress_interval,
                        operation="Downloading",
                        cumulative=True,
                    )

                await client.download_file(
                    bucket,
                    object_key,
                    str(file_path),
                    Callback=callback,
                    Config=s3_transfer_config,
                )
                if callback:
                    callback.finish()
        except Exception as e:
            raise DownloadError(f"Failed to download file from R2: {e}") from e

        return file_path


class _AsyncProgressCallback:
    """Wrapper to track cumulative progress for aioboto3 callback.

    aioboto3 is inconsistent: download_fileobj wraps the callback and passes
    cumulative bytes, while upload_fileobj passes incremental chunk sizes.
    The ``cumulative`` flag controls which mode to use.
    """

    def __init__(
        self,
        callback: Callable[[int], None] | None,
        total_size: int | None = None,
        progress_interval: float | None = None,
        operation: str = "Transferring",
        cumulative: bool = False,
    ) -> None:
        self._callback = callback
        self._bytes_transferred = 0
        self._total_size = total_size
        self._progress_interval = progress_interval
        self._operation = operation
        self._cumulative = cumulative
        self._last_log_time = time.monotonic()
        self._start_time = time.monotonic()

    def __call__(self, bytes_amount: int) -> None:
        if self._cumulative:
            self._bytes_transferred = bytes_amount
        else:
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
