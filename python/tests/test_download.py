"""Tests for download functionality."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pytest_httpx import HTTPXMock

from elaunira.r2index import (
    AsyncR2IndexClient,
    R2IndexClient,
    RemoteTuple,
)
from elaunira.r2index.exceptions import ChecksumVerificationError
from elaunira.r2index.storage import R2TransferConfig


class TestGetByTuple:
    """Tests for get_by_tuple method."""

    @pytest.fixture
    def client(self):
        """Create a test client."""
        return R2IndexClient(
            index_api_url="https://api.example.com",
            index_api_token="test-token",
        )

    def test_get_by_tuple(self, client: R2IndexClient, httpx_mock: HTTPXMock):
        """Test getting a file by remote tuple."""
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip&remote_version=v1",
            json={
                "id": "file123",
                "bucket": "test-bucket",
                "category": "software",
                "entity": "myapp",
                "extension": "zip",
                "media_type": "application/zip",
                "remote_path": "/releases/myapp",
                "remote_filename": "myapp.zip",
                "remote_version": "v1",
                "tags": [],
                "size": 1024,
                "checksum_md5": "abc",
                "checksum_sha1": "def",
                "checksum_sha256": "ghi",
                "checksum_sha512": "jkl",
                "created": 1704067200,
                "updated": 1704067200,
            },
        )

        remote_tuple = RemoteTuple(
            bucket="test-bucket",
            remote_path="/releases/myapp",
            remote_filename="myapp.zip",
            remote_version="v1",
        )
        record = client.get_by_tuple(remote_tuple)

        assert record.id == "file123"
        assert record.bucket == "test-bucket"
        assert record.remote_path == "/releases/myapp"
        assert record.remote_filename == "myapp.zip"
        assert record.remote_version == "v1"


class TestDownload:
    """Tests for download method."""

    @pytest.fixture
    def client_with_r2(self):
        """Create a test client with R2 config."""
        return R2IndexClient(
            index_api_url="https://api.example.com",
            index_api_token="test-token",
            r2_access_key_id="test-key",
            r2_secret_access_key="test-secret",
            r2_endpoint_url="https://r2.example.com",
        )

    def test_download_with_defaults(
        self, client_with_r2: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Test download with default IP and user agent."""
        # Mock checkip.amazonaws.com
        httpx_mock.add_response(
            url="https://checkip.amazonaws.com",
            text="203.0.113.1\n",
        )

        # Mock get_by_tuple
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip&remote_version=v1",
            json={
                "id": "file123",
                "bucket": "test-bucket",
                "category": "software",
                "entity": "myapp",
                "extension": "zip",
                "media_type": "application/zip",
                "remote_path": "/releases/myapp",
                "remote_filename": "myapp.zip",
                "remote_version": "v1",
                "tags": [],
                "size": 1024,
                "checksum_md5": "abc",
                "checksum_sha1": "def",
                "checksum_sha256": "ghi",
                "checksum_sha512": "jkl",
                "created": 1704067200,
                "updated": 1704067200,
            },
        )

        # Mock record_download
        httpx_mock.add_response(
            url="https://api.example.com/downloads",
            method="POST",
            status_code=201,
            json={
                "id": "download123",
                "bucket": "test-bucket",
                "remote_path": "/releases/myapp",
                "remote_filename": "myapp.zip",
                "remote_version": "v1",
                "ip_address": "203.0.113.1",
                "user_agent": "elaunira-r2index/0.1.0",
                "downloaded_at": 1704067200,
                "hour_bucket": 1704067200,
                "day_bucket": 1704067200,
                "month_bucket": 202401,
            },
        )

        destination = tmp_path / "myapp.zip"

        # Mock the R2 storage download
        with patch.object(
            client_with_r2._get_storage(),
            "download_file",
            return_value=destination,
        ) as mock_download:
            downloaded_path, file_record = client_with_r2.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
            )

            mock_download.assert_called_once()
            assert downloaded_path == destination
            assert file_record.id == "file123"

    def test_download_with_explicit_ip_and_user_agent(
        self, client_with_r2: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Test download with explicit IP and user agent."""
        # Mock get_by_tuple
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip&remote_version=v1",
            json={
                "id": "file123",
                "bucket": "test-bucket",
                "category": "software",
                "entity": "myapp",
                "extension": "zip",
                "media_type": "application/zip",
                "remote_path": "/releases/myapp",
                "remote_filename": "myapp.zip",
                "remote_version": "v1",
                "tags": [],
                "size": 1024,
                "checksum_md5": "abc",
                "checksum_sha1": "def",
                "checksum_sha256": "ghi",
                "checksum_sha512": "jkl",
                "created": 1704067200,
                "updated": 1704067200,
            },
        )

        # Mock record_download
        httpx_mock.add_response(
            url="https://api.example.com/downloads",
            method="POST",
            status_code=201,
            json={
                "id": "download123",
                "bucket": "test-bucket",
                "remote_path": "/releases/myapp",
                "remote_filename": "myapp.zip",
                "remote_version": "v1",
                "ip_address": "10.0.0.1",
                "user_agent": "custom-agent/1.0",
                "downloaded_at": 1704067200,
                "hour_bucket": 1704067200,
                "day_bucket": 1704067200,
                "month_bucket": 202401,
            },
        )

        destination = tmp_path / "myapp.zip"

        # Mock the R2 storage download
        with patch.object(
            client_with_r2._get_storage(),
            "download_file",
            return_value=destination,
        ):
            downloaded_path, file_record = client_with_r2.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                ip_address="10.0.0.1",
                user_agent="custom-agent/1.0",
            )

            assert downloaded_path == destination
            assert file_record.id == "file123"


    def test_download_file_not_in_index(
        self, client_with_r2: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Test download succeeds even when file is not registered in the index."""
        # Mock get_by_tuple returning 404
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip&remote_version=v1",
            status_code=404,
            json={
                "code": "FILE_NOT_FOUND",
                "message": "The requested file was not found.",
                "resolution": "Verify the file ID or remote tuple exists.",
            },
        )

        destination = tmp_path / "myapp.zip"

        # Mock the R2 storage download
        with patch.object(
            client_with_r2._get_storage(),
            "download_file",
            return_value=destination,
        ) as mock_download:
            downloaded_path, file_record = client_with_r2.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
            )

            mock_download.assert_called_once()
            assert downloaded_path == destination
            assert file_record is None


    def test_download_without_version(
        self, client_with_r2: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Test download without source_version omits version from object key."""
        # Mock get_by_tuple (without remote_version param)
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip",
            status_code=404,
            json={
                "code": "FILE_NOT_FOUND",
                "message": "The requested file was not found.",
                "resolution": "Verify the file ID or remote tuple exists.",
            },
        )

        destination = tmp_path / "myapp.zip"

        with patch.object(
            client_with_r2._get_storage(),
            "download_file",
            return_value=destination,
        ) as mock_download:
            downloaded_path, file_record = client_with_r2.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                destination=str(destination),
            )

            # Verify object key has no version segment
            call_args = mock_download.call_args
            object_key = call_args[0][1]
            assert object_key == "releases/myapp/myapp.zip"

            assert downloaded_path == destination
            assert file_record is None

    def test_download_with_version_includes_version_in_key(
        self, client_with_r2: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Test download with source_version includes version in object key."""
        httpx_mock.add_response(
            url="https://api.example.com/files/by-tuple?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp&remote_filename=myapp.zip&remote_version=v1",
            status_code=404,
            json={
                "code": "FILE_NOT_FOUND",
                "message": "The requested file was not found.",
                "resolution": "Verify the file ID or remote tuple exists.",
            },
        )

        destination = tmp_path / "myapp.zip"

        with patch.object(
            client_with_r2._get_storage(),
            "download_file",
            return_value=destination,
        ) as mock_download:
            client_with_r2.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                destination=str(destination),
                source_version="v1",
            )

            call_args = mock_download.call_args
            object_key = call_args[0][1]
            assert object_key == "releases/myapp/v1/myapp.zip"


_FILE_RECORD_JSON = {
    "id": "file123",
    "bucket": "test-bucket",
    "category": "software",
    "entity": "myapp",
    "extension": "zip",
    "media_type": "application/zip",
    "remote_path": "/releases/myapp",
    "remote_filename": "myapp.zip",
    "remote_version": "v1",
    "tags": [],
    "size": 1024,
    "checksum_md5": "abc",
    "checksum_sha1": "def",
    "checksum_sha256": "correct-sha256",
    "checksum_sha512": "jkl",
    "created": 1704067200,
    "updated": 1704067200,
}

_DOWNLOAD_RECORD_JSON = {
    "id": "download123",
    "bucket": "test-bucket",
    "remote_path": "/releases/myapp",
    "remote_filename": "myapp.zip",
    "remote_version": "v1",
    "ip_address": "10.0.0.1",
    "user_agent": "test",
    "downloaded_at": 1704067200,
    "hour_bucket": 1704067200,
    "day_bucket": 1704067200,
    "month_bucket": 202401,
}

_BY_TUPLE_URL = (
    "https://api.example.com/files/by-tuple"
    "?bucket=test-bucket&remote_path=%2Freleases%2Fmyapp"
    "&remote_filename=myapp.zip&remote_version=v1"
)

_CORRECT = MagicMock(sha256="correct-sha256")
_WRONG = MagicMock(sha256="wrong-sha256")


class TestDownloadChecksumRetry:
    """Tests for checksum verification and retry logic in R2IndexClient.download."""

    @pytest.fixture
    def client(self):
        return R2IndexClient(
            index_api_url="https://api.example.com",
            index_api_token="test-token",
            r2_access_key_id="test-key",
            r2_secret_access_key="test-secret",
            r2_endpoint_url="https://r2.example.com",
        )

    def _mock_http(self, httpx_mock: HTTPXMock, *, with_download_record: bool = True) -> None:
        httpx_mock.add_response(url=_BY_TUPLE_URL, json=_FILE_RECORD_JSON)
        if with_download_record:
            httpx_mock.add_response(url="https://checkip.amazonaws.com", text="10.0.0.1\n")
            httpx_mock.add_response(
                url="https://api.example.com/downloads",
                method="POST",
                status_code=201,
                json=_DOWNLOAD_RECORD_JSON,
            )

    def test_checksum_matches_first_attempt(
        self, client: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Checksum matches on first attempt: download_file called exactly once."""
        self._mock_http(httpx_mock)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", return_value=destination) as mock_dl,
            patch("elaunira.r2index.client.compute_checksums", return_value=_CORRECT),
        ):
            client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
            )

        mock_dl.assert_called_once()

    def test_checksum_retry_succeeds(
        self, client: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Checksum fails on first attempt, matches on retry: download_file called twice."""
        self._mock_http(httpx_mock)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", return_value=destination) as mock_dl,
            patch("elaunira.r2index.client.compute_checksums", side_effect=[_WRONG, _CORRECT]),
        ):
            client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
            )

        assert mock_dl.call_count == 2

    def test_checksum_fails_all_retries(
        self, client: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """All attempts fail: raises ChecksumVerificationError, download_file called 3 times."""
        self._mock_http(httpx_mock, with_download_record=False)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", return_value=destination) as mock_dl,
            patch("elaunira.r2index.client.compute_checksums", return_value=_WRONG),
            pytest.raises(ChecksumVerificationError, match="3 attempt"),
        ):
            client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
                checksum_retries=2,
            )

        assert mock_dl.call_count == 3

    def test_checksum_custom_retry_count(
        self, client: R2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """checksum_retries=1: raises after 2 total attempts."""
        self._mock_http(httpx_mock, with_download_record=False)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", return_value=destination) as mock_dl,
            patch("elaunira.r2index.client.compute_checksums", return_value=_WRONG),
            pytest.raises(ChecksumVerificationError, match="2 attempt"),
        ):
            client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
                checksum_retries=1,
            )

        assert mock_dl.call_count == 2


class TestAsyncDownloadChecksumRetry:
    """Tests for checksum verification and retry logic in AsyncR2IndexClient.download."""

    @pytest.fixture
    def client(self):
        return AsyncR2IndexClient(
            index_api_url="https://api.example.com",
            index_api_token="test-token",
            r2_access_key_id="test-key",
            r2_secret_access_key="test-secret",
            r2_endpoint_url="https://r2.example.com",
        )

    def _mock_http(self, httpx_mock: HTTPXMock, *, with_download_record: bool = True) -> None:
        httpx_mock.add_response(url=_BY_TUPLE_URL, json=_FILE_RECORD_JSON)
        if with_download_record:
            httpx_mock.add_response(url="https://checkip.amazonaws.com", text="10.0.0.1\n")
            httpx_mock.add_response(
                url="https://api.example.com/downloads",
                method="POST",
                status_code=201,
                json=_DOWNLOAD_RECORD_JSON,
            )

    async def test_checksum_matches_first_attempt(
        self, client: AsyncR2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Checksum matches on first attempt: download_file called exactly once."""
        self._mock_http(httpx_mock)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", new=AsyncMock(return_value=destination)) as mock_dl,
            patch("elaunira.r2index.async_client.compute_checksums_async", new=AsyncMock(return_value=_CORRECT)),
        ):
            await client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
            )

        mock_dl.assert_called_once()

    async def test_checksum_retry_succeeds(
        self, client: AsyncR2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """Checksum fails on first attempt, matches on retry: download_file called twice."""
        self._mock_http(httpx_mock)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", new=AsyncMock(return_value=destination)) as mock_dl,
            patch("elaunira.r2index.async_client.compute_checksums_async", new=AsyncMock(side_effect=[_WRONG, _CORRECT])),
        ):
            await client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
            )

        assert mock_dl.call_count == 2

    async def test_checksum_fails_all_retries(
        self, client: AsyncR2IndexClient, httpx_mock: HTTPXMock, tmp_path: Path
    ):
        """All attempts fail: raises ChecksumVerificationError, download_file called 3 times."""
        self._mock_http(httpx_mock, with_download_record=False)
        destination = tmp_path / "myapp.zip"

        with (
            patch.object(client._get_storage(), "download_file", new=AsyncMock(return_value=destination)) as mock_dl,
            patch("elaunira.r2index.async_client.compute_checksums_async", new=AsyncMock(return_value=_WRONG)),
            pytest.raises(ChecksumVerificationError, match="3 attempt"),
        ):
            await client.download(
                bucket="test-bucket",
                source_path="/releases/myapp",
                source_filename="myapp.zip",
                source_version="v1",
                destination=str(destination),
                verify_checksum=True,
                checksum_retries=2,
            )

        assert mock_dl.call_count == 3


class TestR2TransferConfig:
    """Tests for R2TransferConfig."""

    def test_default_values(self):
        """Test default transfer config values."""
        config = R2TransferConfig()
        assert config.multipart_threshold == 32 * 1024 * 1024  # 32MB
        assert config.multipart_chunksize == 32 * 1024 * 1024  # 32MB
        assert config.max_concurrency >= 16  # Floor sized for multi-Gbps links
        assert config.use_threads is True

    def test_custom_values(self):
        """Test custom transfer config values."""
        config = R2TransferConfig(
            multipart_threshold=50 * 1024 * 1024,
            multipart_chunksize=25 * 1024 * 1024,
            max_concurrency=8,
            use_threads=False,
        )
        assert config.multipart_threshold == 50 * 1024 * 1024
        assert config.multipart_chunksize == 25 * 1024 * 1024
        assert config.max_concurrency == 8
        assert config.use_threads is False
