"""Tests for checksum computation."""

import tempfile
from pathlib import Path

import pytest

from elaunira.r2index import ChecksumResult, compute_checksums, compute_checksums_from_file_object


def test_compute_checksums_simple_file():
    """Test checksum computation for a simple file."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"Hello, World!")
        temp_path = Path(f.name)

    try:
        result = compute_checksums(temp_path)

        assert isinstance(result, ChecksumResult)
        assert result.size == 13
        assert result.md5 == "65a8e27d8879283831b664bd8b7f0ad4"
        assert result.sha1 == "0a0a9f2a6772942557ab5355d76af442f8f65e01"
        assert (
            result.sha256 == "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
        )
        assert result.sha512 == (
            "374d794a95cdcfd8b35993185fef9ba368f160d8daf432d08ba9f1ed1e5abe6c"
            "c69291e0fa2fe0006a52570ef18c19def4e617c33ce52ef0a6e5fbe318cb0387"
        )
    finally:
        temp_path.unlink()


def test_compute_checksums_empty_file():
    """Test checksum computation for an empty file."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        temp_path = Path(f.name)

    try:
        result = compute_checksums(temp_path)

        assert result.size == 0
        assert result.md5 == "d41d8cd98f00b204e9800998ecf8427e"
    finally:
        temp_path.unlink()


def test_compute_checksums_from_file_object():
    """Test checksum computation from a file object."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"Test content")
        temp_path = Path(f.name)

    try:
        with open(temp_path, "rb") as f:
            result = compute_checksums_from_file_object(f)

        assert result.size == 12
        assert result.md5 is not None
        assert result.sha1 is not None
        assert result.sha256 is not None
        assert result.sha512 is not None
    finally:
        temp_path.unlink()


@pytest.mark.asyncio
async def test_compute_checksums_async():
    """Test async checksum computation."""
    from elaunira.r2index import compute_checksums_async

    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"Async test content")
        temp_path = Path(f.name)

    try:
        result = await compute_checksums_async(temp_path)

        assert isinstance(result, ChecksumResult)
        assert result.size == 18
    finally:
        temp_path.unlink()


def test_compute_checksums_multi_chunk_parallel():
    """Hashes must match across many chunks, exercising the parallel fan-out."""
    import hashlib
    import os

    from elaunira.r2index.checksums import CHUNK_SIZE

    # Span several chunks plus a partial tail so the reader loop runs many
    # iterations and every hasher queue gets repeatedly fed and drained.
    payload = os.urandom(CHUNK_SIZE * 3 + 12345)

    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload)
        temp_path = Path(f.name)

    try:
        result = compute_checksums(temp_path)

        assert result.size == len(payload)
        assert result.md5 == hashlib.md5(payload).hexdigest()
        assert result.sha1 == hashlib.sha1(payload).hexdigest()
        assert result.sha256 == hashlib.sha256(payload).hexdigest()
        assert result.sha512 == hashlib.sha512(payload).hexdigest()
    finally:
        temp_path.unlink()
