#!/usr/bin/env python3
"""End-to-end test for r2index API using the Python client library.

Usage:
    python e2e_test.py <api_url> <api_token> [<r2_access_key_id> <r2_secret_access_key> <r2_account_id>]

Example:
    python e2e_test.py https://r2index.example.com my-secret-token
    python e2e_test.py https://r2index.example.com my-secret-token access-key secret-key account-id
"""

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from elaunira.r2index import (
    R2IndexClient,
    R2Config,
    R2Storage,
    FileCreateRequest,
    FileUpdateRequest,
    RemoteTuple,
    NotFoundError,
    ValidationError,
    AuthenticationError,
    DownloadRecordRequest,
)


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    RESET = "\033[0m"


class E2ETest:
    def __init__(
        self,
        api_url: str,
        api_token: str,
        r2_access_key_id: str | None = None,
        r2_secret_access_key: str | None = None,
        r2_account_id: str | None = None,
    ):
        self.api_url = api_url
        self.api_token = api_token
        self.r2_enabled = all([r2_access_key_id, r2_secret_access_key, r2_account_id])
        self.passed = 0
        self.failed = 0

        if self.r2_enabled:
            self.client = R2IndexClient(
                index_api_url=api_url,
                index_api_token=api_token,
                r2_access_key_id=r2_access_key_id,
                r2_secret_access_key=r2_secret_access_key,
                r2_endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
            )
        else:
            self.client = R2IndexClient(index_api_url=api_url, index_api_token=api_token)

    def pass_test(self, name: str) -> None:
        print(f"{Colors.GREEN}✓ {name}{Colors.RESET}")
        self.passed += 1

    def fail_test(self, name: str, error: str = "") -> None:
        print(f"{Colors.RED}✗ {name}{Colors.RESET}")
        if error:
            print(f"{Colors.RED}  Error: {error}{Colors.RESET}")
        self.failed += 1

    def section(self, name: str) -> None:
        print(f"\n{Colors.YELLOW}=== {name} ==={Colors.RESET}")

    def run(self) -> bool:
        print("=" * 50)
        print("R2Index API End-to-End Test (Python Client)")
        print("=" * 50)
        print(f"API URL: {self.api_url}")
        print(f"R2 Storage: {'enabled' if self.r2_enabled else 'disabled'}")
        print("=" * 50)

        try:
            self.test_health()
            self.test_authentication()
            file_id = self.test_file_crud()
            self.test_download_tracking()
            self.test_analytics()
            self.test_file_deletion(file_id)
            self.test_error_handling()
            self.test_maintenance()
            if self.r2_enabled:
                self.test_upload_download()
                self.test_checksum_files()
                self.test_large_file_upload()
        finally:
            self.client.close()

        # Print summary
        print()
        print("=" * 50)
        print("Test Results")
        print("=" * 50)
        print(f"{Colors.GREEN}Passed: {self.passed}{Colors.RESET}")
        print(f"{Colors.RED}Failed: {self.failed}{Colors.RESET}")
        print("=" * 50)

        return self.failed == 0

    def test_health(self) -> None:
        self.section("Health Check")
        try:
            health = self.client.health()
            if health.status == "ok":
                self.pass_test("GET /health returns ok")
            else:
                self.fail_test("GET /health", f"Unexpected status: {health.status}")
        except Exception as e:
            self.fail_test("GET /health", str(e))

    def test_authentication(self) -> None:
        self.section("Authentication")

        # Test without auth (empty token causes invalid header or auth error)
        try:
            bad_client = R2IndexClient(index_api_url=self.api_url, index_api_token="")
            bad_client.list_files()
            bad_client.close()
            self.fail_test("Should reject empty token")
        except (AuthenticationError, httpx.LocalProtocolError):
            # LocalProtocolError for invalid header, AuthenticationError for 401/403
            self.pass_test("Rejects empty token")

        # Test with wrong token (only rejects if R2INDEX_READ_TOKEN is set)
        try:
            bad_client = R2IndexClient(index_api_url=self.api_url, index_api_token="wrong-token")
            bad_client.list_files()
            bad_client.close()
            self.pass_test("Reads are public (no R2INDEX_READ_TOKEN configured)")
        except AuthenticationError:
            self.pass_test("Rejects invalid token (403)")
        except Exception as e:
            self.fail_test("Auth test", str(e))

        # Test with valid token
        try:
            self.client.list_files()
            self.pass_test("Accepts valid token (200)")
        except Exception as e:
            self.fail_test("Valid token test", str(e))

    def test_file_crud(self) -> str | None:
        self.section("File CRUD Operations")
        file_id = None

        # Create file
        try:
            create_request = FileCreateRequest(
                bucket="e2e-test-bucket",
                category="e2e-test",
                entity="test-entity",
                extension="txt",
                media_type="text/plain",
                remote_path="/e2e-tests",
                remote_filename="test-file.txt",
                remote_version="v1",
                name="E2E Test File",
                size=1024,
                checksum_md5="d41d8cd98f00b204e9800998ecf8427e",
                checksum_sha1="da39a3ee5e6b4b0d3255bfef95601890afd80709",
                checksum_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                checksum_sha512="cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
                tags=["e2e", "test"],
            )
            file_record = self.client.create(create_request)
            file_id = file_record.id
            self.pass_test(f"POST /files - Create file (id: {file_id})")
        except Exception as e:
            self.fail_test("POST /files - Create file", str(e))
            return None

        # Get file by ID
        try:
            file_record = self.client.get(file_id)
            if file_record.id == file_id:
                self.pass_test("GET /files/:id - Get file by ID")
            else:
                self.fail_test("GET /files/:id", "ID mismatch")
        except Exception as e:
            self.fail_test("GET /files/:id", str(e))

        # Update file
        try:
            update_request = FileUpdateRequest(
                name="Updated E2E Test File",
                size=2048,
            )
            updated = self.client.update(file_id, update_request)
            if updated.name == "Updated E2E Test File" and updated.size == 2048:
                self.pass_test("PUT /files/:id - Update file")
            else:
                self.fail_test("PUT /files/:id", "Update not applied")
        except Exception as e:
            self.fail_test("PUT /files/:id", str(e))

        # List files with filters
        try:
            self.client.list_files(category="e2e-test")
            self.pass_test("GET /files?category= - List with filter")
        except Exception as e:
            self.fail_test("GET /files?category=", str(e))

        # List files with bucket filter
        try:
            self.client.list_files(bucket="e2e-test-bucket")
            self.pass_test("GET /files?bucket= - List with bucket filter")
        except Exception as e:
            self.fail_test("GET /files?bucket=", str(e))

        # List files with tags filter
        try:
            self.client.list_files(tags=["e2e", "test"])
            self.pass_test("GET /files?tags= - List with tags filter")
        except Exception as e:
            self.fail_test("GET /files?tags=", str(e))

        # Get file by tuple
        try:
            remote_tuple = RemoteTuple(
                bucket="e2e-test-bucket",
                remote_path="/e2e-tests",
                remote_filename="test-file.txt",
                remote_version="v1",
            )
            file_record = self.client.get_by_tuple(remote_tuple)
            if file_record.id == file_id:
                self.pass_test("GET /files/by-tuple - Get by remote tuple")
            else:
                self.fail_test("GET /files/by-tuple", "ID mismatch")
        except Exception as e:
            self.fail_test("GET /files/by-tuple", str(e))

        # Get nested index
        try:
            self.client.index(category="e2e-test")
            self.pass_test("GET /files/index - Nested index")
        except Exception as e:
            self.fail_test("GET /files/index", str(e))

        return file_id

    def test_download_tracking(self) -> None:
        self.section("Download Tracking")

        # Record downloads using remote tuple
        try:
            for i in range(4):
                download_request = DownloadRecordRequest(
                    bucket="e2e-test-bucket",
                    remote_path="/e2e-tests",
                    remote_filename=f"test-file-{i}.txt",
                    remote_version="v1",
                    ip_address=f"192.168.1.{100 + i}",
                    user_agent="E2E-Test-Agent/1.0",
                )
                self.client.record_download(download_request)
            self.pass_test("POST /downloads - Record downloads")
        except Exception as e:
            self.fail_test("POST /downloads", str(e))

    def test_analytics(self) -> None:
        self.section("Analytics")

        now = datetime.now(timezone.utc)
        start = now - timedelta(days=1)
        end = now + timedelta(hours=1)

        # Timeseries
        try:
            self.client.get_timeseries(start=start, end=end, scale="hour")
            self.pass_test("GET /analytics/timeseries - Time series data")
        except Exception as e:
            self.fail_test("GET /analytics/timeseries", str(e))

        # Summary
        try:
            self.client.get_summary(start=start, end=end)
            self.pass_test("GET /analytics/summary - Summary stats")
        except Exception as e:
            self.fail_test("GET /analytics/summary", str(e))

        # By IP
        try:
            self.client.get_downloads_by_ip(
                ip_address="192.168.1.100",
                start=start,
                end=end,
            )
            self.pass_test("GET /analytics/by-ip - Downloads by IP")
        except Exception as e:
            self.fail_test("GET /analytics/by-ip", str(e))

        # User agents
        try:
            self.client.get_user_agents(start=start, end=end)
            self.pass_test("GET /analytics/user-agents - User agent stats")
        except Exception as e:
            self.fail_test("GET /analytics/user-agents", str(e))

    def test_file_deletion(self, file_id: str | None) -> None:
        self.section("File Deletion")

        # Delete by ID
        if file_id:
            try:
                self.client.delete(file_id)
                self.pass_test("DELETE /files/:id - Delete by ID")
            except Exception as e:
                self.fail_test("DELETE /files/:id", str(e))

        # Create and delete by tuple
        try:
            create_request = FileCreateRequest(
                bucket="e2e-test-bucket",
                category="e2e-test",
                entity="test-entity-2",
                extension="txt",
                media_type="text/plain",
                remote_path="/e2e-tests",
                remote_filename="test-file-2.txt",
                remote_version="v1",
                size=512,
                checksum_md5="d41d8cd98f00b204e9800998ecf8427e",
                checksum_sha1="da39a3ee5e6b4b0d3255bfef95601890afd80709",
                checksum_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                checksum_sha512="cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
            )
            self.client.create(create_request)

            remote_tuple = RemoteTuple(
                bucket="e2e-test-bucket",
                remote_path="/e2e-tests",
                remote_filename="test-file-2.txt",
                remote_version="v1",
            )
            self.client.delete_by_tuple(remote_tuple)
            self.pass_test("DELETE /files - Delete by remote tuple")
        except Exception as e:
            self.fail_test("DELETE /files (tuple)", str(e))

    def test_error_handling(self) -> None:
        self.section("Error Handling")

        # 404 for non-existent file
        try:
            self.client.get("non-existent-id-12345")
            self.fail_test("Should raise NotFoundError")
        except NotFoundError:
            self.pass_test("GET /files/:id - Returns 404 for non-existent")
        except Exception as e:
            self.fail_test("404 test", str(e))

        # 400 for invalid input
        try:
            invalid_request = FileCreateRequest(
                bucket="",  # Invalid: empty bucket
                category="test",
                entity="test",
                extension="txt",
                media_type="text/plain",
                remote_path="/test",
                remote_filename="test.txt",
                remote_version="v1",
                size=100,
                checksum_md5="d41d8cd98f00b204e9800998ecf8427e",
                checksum_sha1="da39a3ee5e6b4b0d3255bfef95601890afd80709",
                checksum_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                checksum_sha512="cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
            )
            self.client.create(invalid_request)
            self.fail_test("Should raise ValidationError")
        except ValidationError:
            self.pass_test("POST /files - Returns 400 for invalid input")
        except Exception as e:
            self.fail_test("400 test", str(e))

    def test_maintenance(self) -> None:
        self.section("Maintenance")

        try:
            response = self.client.cleanup_downloads()
            self.pass_test(f"POST /maintenance/cleanup-downloads (deleted: {response.deleted_count})")
        except Exception as e:
            self.fail_test("POST /maintenance/cleanup-downloads", str(e))

    def test_upload_download(self) -> None:
        self.section("R2 Upload/Download")

        bucket = "r2index-e2e-tests"
        version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        uploaded_record = None

        # Create a temporary test file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(f"E2E test file created at {datetime.now(timezone.utc).isoformat()}\n")
            f.write("This file tests the upload and download functionality.\n")
            test_file_path = Path(f.name)

        try:
            # Test upload
            try:
                uploaded_record = self.client.upload(
                    bucket=bucket,
                    source=test_file_path,
                    category="e2e-test",
                    entity="upload-test",
                    extension="txt",
                    media_type="text/plain",
                    destination_path="/e2e-tests",
                    destination_filename="upload-test.txt",
                    destination_version=version,
                    name="E2E Upload Test",
                    tags=["e2e", "upload"],
                )
                if uploaded_record.checksum_md5 and uploaded_record.checksum_sha256:
                    self.pass_test(f"Upload file to R2 (id: {uploaded_record.id})")
                else:
                    self.fail_test("Upload file to R2", "Missing checksums")
            except Exception as e:
                self.fail_test("Upload file to R2", str(e))
                return

            # Test download
            with tempfile.TemporaryDirectory() as tmpdir:
                try:
                    download_path, download_record = self.client.download(
                        bucket=bucket,
                        source_path="/e2e-tests",
                        source_filename="upload-test.txt",
                        source_version=version,
                        destination=Path(tmpdir) / "downloaded.txt",
                    )
                    if download_path.exists() and download_record.id == uploaded_record.id:
                        self.pass_test("Download file from R2")
                    else:
                        self.fail_test("Download file from R2", "File not downloaded or ID mismatch")
                except Exception as e:
                    self.fail_test("Download file from R2", str(e))

            # Test cleanup: delete from R2
            try:
                self.client.delete_from_r2(
                    bucket=bucket,
                    path="/e2e-tests",
                    filename="upload-test.txt",
                    version=version,
                )
                self.pass_test("Delete file from R2")
            except Exception as e:
                self.fail_test("Delete file from R2", str(e))

            # Test cleanup: delete from index
            try:
                self.client.delete(uploaded_record.id)
                self.pass_test("Delete file from index")
                uploaded_record = None  # Mark as cleaned up
            except Exception as e:
                self.fail_test("Delete file from index", str(e))

        finally:
            # Cleanup local temp file
            test_file_path.unlink(missing_ok=True)
            # Fallback cleanup if tests failed
            if uploaded_record:
                try:
                    self.client.delete_from_r2(
                        bucket=bucket,
                        path="/e2e-tests",
                        filename="upload-test.txt",
                        version=version,
                    )
                except Exception:
                    pass
                try:
                    self.client.delete(uploaded_record.id)
                except Exception:
                    pass

    def test_checksum_files(self) -> None:
        self.section("Checksum Files Upload")

        bucket = "r2index-e2e-tests"
        version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        uploaded_record = None
        checksum_exts = ["md5", "sha1", "sha256", "sha512"]

        # Create a temporary test file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(f"E2E checksum test file created at {datetime.now(timezone.utc).isoformat()}\n")
            test_file_path = Path(f.name)

        try:
            # Test upload with checksum files
            try:
                uploaded_record = self.client.upload(
                    bucket=bucket,
                    source=test_file_path,
                    category="e2e-test",
                    entity="checksum-test",
                    extension="txt",
                    media_type="text/plain",
                    destination_path="/e2e-tests",
                    destination_filename="checksum-test.txt",
                    destination_version=version,
                    name="E2E Checksum Test",
                    tags=["e2e", "checksum"],
                    create_checksum_files=True,
                )
                self.pass_test(f"Upload file with checksum files (id: {uploaded_record.id})")
            except Exception as e:
                self.fail_test("Upload file with checksum files", str(e))
                return

            # Verify checksum files exist and have correct content
            storage = self.client._get_storage()
            object_key = f"e2e-tests/{version}/checksum-test.txt"

            for ext in checksum_exts:
                checksum_key = f"{object_key}.{ext}"
                try:
                    if storage.object_exists(bucket, checksum_key):
                        self.pass_test(f"Checksum file exists: .{ext}")
                    else:
                        self.fail_test(f"Checksum file exists: .{ext}", "File not found")
                except Exception as e:
                    self.fail_test(f"Checksum file exists: .{ext}", str(e))

            # Download and verify one checksum file content
            with tempfile.TemporaryDirectory() as tmpdir:
                try:
                    md5_path = Path(tmpdir) / "checksum.md5"
                    storage.download_file(bucket, f"{object_key}.md5", md5_path)
                    content = md5_path.read_text()
                    # Format should be: "<checksum>  <filename>\n"
                    if uploaded_record.checksum_md5 in content and "checksum-test.txt" in content:
                        self.pass_test("Checksum file content is correct")
                    else:
                        self.fail_test("Checksum file content", f"Unexpected content: {content}")
                except Exception as e:
                    self.fail_test("Checksum file content", str(e))

            # Cleanup: delete checksum files from R2
            for ext in checksum_exts:
                try:
                    storage.delete_object(bucket, f"{object_key}.{ext}")
                except Exception:
                    pass

            # Cleanup: delete main file from R2
            try:
                self.client.delete_from_r2(
                    bucket=bucket,
                    path="/e2e-tests",
                    filename="checksum-test.txt",
                    version=version,
                )
                self.pass_test("Delete checksum test files from R2")
            except Exception as e:
                self.fail_test("Delete checksum test files from R2", str(e))

            # Cleanup: delete from index
            try:
                self.client.delete(uploaded_record.id)
                self.pass_test("Delete checksum test from index")
                uploaded_record = None
            except Exception as e:
                self.fail_test("Delete checksum test from index", str(e))

        finally:
            # Cleanup local temp file
            test_file_path.unlink(missing_ok=True)
            # Fallback cleanup if tests failed
            if uploaded_record:
                storage = self.client._get_storage()
                object_key = f"e2e-tests/{version}/checksum-test.txt"
                for ext in checksum_exts:
                    try:
                        storage.delete_object(bucket, f"{object_key}.{ext}")
                    except Exception:
                        pass
                try:
                    self.client.delete_from_r2(
                        bucket=bucket,
                        path="/e2e-tests",
                        filename="checksum-test.txt",
                        version=version,
                    )
                except Exception:
                    pass
                try:
                    self.client.delete(uploaded_record.id)
                except Exception:
                    pass

    def test_large_file_upload(self) -> None:
        # File size configurable via E2E_LARGE_FILE_SIZE_GB env var (default: 5GB)
        size_gb = int(os.environ.get("E2E_LARGE_FILE_SIZE_GB", "5"))
        file_size = size_gb * 1024 * 1024 * 1024

        self.section(f"Large File Upload ({size_gb}GB)")

        bucket = "r2index-e2e-tests"
        version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        uploaded_record = None
        chunk_size = 64 * 1024 * 1024  # 64MB chunks for generation

        # Create a temporary directory for the large file
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file_path = Path(tmpdir) / "large-test-file.bin"
            download_path = Path(tmpdir) / "downloaded-large-file.bin"

            try:
                # Generate large random file
                print(f"  Generating {file_size / (1024**3):.1f}GB random file...")
                bytes_written = 0
                with open(test_file_path, "wb") as f:
                    while bytes_written < file_size:
                        chunk = os.urandom(min(chunk_size, file_size - bytes_written))
                        f.write(chunk)
                        bytes_written += len(chunk)
                        progress_pct = (bytes_written / file_size) * 100
                        print(f"\r  Generated: {bytes_written / (1024**3):.2f}GB ({progress_pct:.1f}%)", end="", flush=True)
                print()  # newline after progress

                actual_size = test_file_path.stat().st_size
                if actual_size != file_size:
                    self.fail_test("Generate large file", f"Expected {file_size} bytes, got {actual_size}")
                    return

                self.pass_test(f"Generate {file_size / (1024**3):.1f}GB random file")

                # Upload with progress
                def upload_progress(bytes_uploaded: int) -> None:
                    pct = (bytes_uploaded / file_size) * 100
                    print(f"\r  Uploading: {bytes_uploaded / (1024**3):.2f}GB ({pct:.1f}%)", end="", flush=True)

                try:
                    print("  Starting upload...")
                    uploaded_record = self.client.upload(
                        bucket=bucket,
                        source=test_file_path,
                        category="e2e-test",
                        entity="large-file-test",
                        extension="bin",
                        media_type="application/octet-stream",
                        destination_path="/e2e-tests",
                        destination_filename="large-test-file.bin",
                        destination_version=version,
                        name="E2E Large File Test",
                        tags=["e2e", "large-file"],
                        progress_callback=upload_progress,
                    )
                    print()  # newline after progress
                    if uploaded_record.size == file_size:
                        self.pass_test(f"Upload {file_size / (1024**3):.1f}GB file to R2")
                    else:
                        self.fail_test("Upload large file", f"Size mismatch: expected {file_size}, got {uploaded_record.size}")
                except Exception as e:
                    print()  # newline after progress
                    self.fail_test("Upload large file to R2", str(e))
                    return

                # Download with progress
                def download_progress(bytes_downloaded: int) -> None:
                    pct = (bytes_downloaded / file_size) * 100
                    print(f"\r  Downloading: {bytes_downloaded / (1024**3):.2f}GB ({pct:.1f}%)", end="", flush=True)

                try:
                    print("  Starting download...")
                    downloaded_file, _ = self.client.download(
                        bucket=bucket,
                        source_path="/e2e-tests",
                        source_filename="large-test-file.bin",
                        source_version=version,
                        destination=download_path,
                        progress_callback=download_progress,
                    )
                    print()  # newline after progress

                    downloaded_size = downloaded_file.stat().st_size
                    if downloaded_size == file_size:
                        self.pass_test(f"Download {file_size / (1024**3):.1f}GB file from R2")
                    else:
                        self.fail_test("Download large file", f"Size mismatch: expected {file_size}, got {downloaded_size}")
                except Exception as e:
                    print()  # newline after progress
                    self.fail_test("Download large file from R2", str(e))

                # Verify checksums match
                try:
                    original_checksum = uploaded_record.checksum_md5
                    from elaunira.r2index.checksums import compute_checksums
                    downloaded_checksums = compute_checksums(download_path)
                    if downloaded_checksums.md5 == original_checksum:
                        self.pass_test("Verify large file checksum")
                    else:
                        self.fail_test("Verify checksum", f"MD5 mismatch: {original_checksum} vs {downloaded_checksums.md5}")
                except Exception as e:
                    self.fail_test("Verify large file checksum", str(e))

                # Cleanup R2
                try:
                    self.client.delete_from_r2(
                        bucket=bucket,
                        path="/e2e-tests",
                        filename="large-test-file.bin",
                        version=version,
                    )
                    self.pass_test("Delete large file from R2")
                except Exception as e:
                    self.fail_test("Delete large file from R2", str(e))

                # Cleanup index
                try:
                    self.client.delete(uploaded_record.id)
                    self.pass_test("Delete large file from index")
                    uploaded_record = None
                except Exception as e:
                    self.fail_test("Delete large file from index", str(e))

            finally:
                # Fallback cleanup
                if uploaded_record:
                    try:
                        self.client.delete_from_r2(
                            bucket=bucket,
                            path="/e2e-tests",
                            filename="large-test-file.bin",
                            version=version,
                        )
                    except Exception:
                        pass
                    try:
                        self.client.delete(uploaded_record.id)
                    except Exception:
                        pass


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python e2e_test.py <api_url> <api_token> [<r2_access_key_id> <r2_secret_access_key> <r2_account_id>]")
        print("Example: python e2e_test.py https://r2index.example.com my-secret-token")
        print("         python e2e_test.py https://r2index.example.com my-secret-token access-key secret-key account-id")
        sys.exit(1)

    api_url = sys.argv[1]
    api_token = sys.argv[2]

    # Optional R2 credentials
    r2_access_key_id = sys.argv[3] if len(sys.argv) > 3 else None
    r2_secret_access_key = sys.argv[4] if len(sys.argv) > 4 else None
    r2_account_id = sys.argv[5] if len(sys.argv) > 5 else None

    test = E2ETest(
        api_url,
        api_token,
        r2_access_key_id=r2_access_key_id,
        r2_secret_access_key=r2_secret_access_key,
        r2_account_id=r2_account_id,
    )
    success = test.run()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
