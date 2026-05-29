"""Streaming checksum computation for large files."""

import hashlib
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from queue import Queue
from typing import BinaryIO

from .storage import _format_bytes

logger = logging.getLogger(__name__)

# 8MB chunk size for memory-efficient processing of large files
CHUNK_SIZE = 8 * 1024 * 1024

# Max chunks buffered per hasher queue. Bounded to provide backpressure: the
# reader blocks once the slowest hasher falls this far behind, capping memory
# at ~CHUNK_SIZE * QUEUE_DEPTH * len(hashers).
_QUEUE_DEPTH = 4


@dataclass
class ChecksumResult:
    """Result of checksum computation."""

    md5: str
    sha1: str
    sha256: str
    sha512: str
    size: int


def compute_checksums(file_path: str | Path) -> ChecksumResult:
    """
    Compute MD5, SHA1, SHA256, and SHA512 checksums for a file.

    Reads the file in chunks for memory-efficient processing of large files.
    All checksums are computed in a single pass through the file.

    Args:
        file_path: Path to the file to compute checksums for.

    Returns:
        ChecksumResult containing all checksums and file size.
    """
    file_path = Path(file_path)
    total_size = file_path.stat().st_size

    md5_hash = hashlib.md5()
    sha1_hash = hashlib.sha1()
    sha256_hash = hashlib.sha256()
    sha512_hash = hashlib.sha512()

    logger.info("Computing checksums for %s (%s)", file_path.name, _format_bytes(total_size))

    size = 0

    with open(file_path, "rb") as f:
        size = _compute_from_file_object(
            f, md5_hash, sha1_hash, sha256_hash, sha512_hash, total_size=total_size,
        )

    logger.info("Checksums computed for %s", file_path.name)

    return ChecksumResult(
        md5=md5_hash.hexdigest(),
        sha1=sha1_hash.hexdigest(),
        sha256=sha256_hash.hexdigest(),
        sha512=sha512_hash.hexdigest(),
        size=size,
    )


def compute_checksums_from_file_object(file_obj: BinaryIO) -> ChecksumResult:
    """
    Compute checksums from a file-like object.

    Args:
        file_obj: Binary file-like object to read from.

    Returns:
        ChecksumResult containing all checksums and total bytes read.
    """
    md5_hash = hashlib.md5()
    sha1_hash = hashlib.sha1()
    sha256_hash = hashlib.sha256()
    sha512_hash = hashlib.sha512()

    size = _compute_from_file_object(file_obj, md5_hash, sha1_hash, sha256_hash, sha512_hash)

    return ChecksumResult(
        md5=md5_hash.hexdigest(),
        sha1=sha1_hash.hexdigest(),
        sha256=sha256_hash.hexdigest(),
        sha512=sha512_hash.hexdigest(),
        size=size,
    )


def _compute_from_file_object(
    file_obj: BinaryIO,
    md5_hash: "hashlib._Hash",
    sha1_hash: "hashlib._Hash",
    sha256_hash: "hashlib._Hash",
    sha512_hash: "hashlib._Hash",
    total_size: int | None = None,
) -> int:
    """
    Internal helper to compute checksums from a file object.

    Reads the file once on the calling thread and fans each chunk out to a
    dedicated worker thread per hash algorithm. hashlib releases the GIL
    inside ``update()``, so the four hashers run truly in parallel on
    multi-core CPUs and the overall throughput is bound by the slowest
    hasher (typically MD5) instead of their sum.

    Returns the total number of bytes read.
    """
    hashers = (md5_hash, sha1_hash, sha256_hash, sha512_hash)
    queues: list[Queue] = [Queue(maxsize=_QUEUE_DEPTH) for _ in hashers]
    errors: list[BaseException] = []
    errors_lock = threading.Lock()

    def worker(hasher: "hashlib._Hash", q: Queue) -> None:
        try:
            while True:
                chunk = q.get()
                if chunk is None:
                    return
                hasher.update(chunk)
        except BaseException as exc:  # pragma: no cover - defensive
            with errors_lock:
                errors.append(exc)
            # Drain remaining items so the reader doesn't deadlock on a full queue.
            while True:
                item = q.get()
                if item is None:
                    return

    threads = [
        threading.Thread(target=worker, args=(h, q), daemon=True, name=f"hasher-{h.name}")
        for h, q in zip(hashers, queues, strict=True)
    ]
    started: list[threading.Thread] = []

    size = 0
    last_log = time.monotonic()
    start = time.monotonic()

    try:
        for t in threads:
            t.start()
            started.append(t)

        while True:
            chunk = file_obj.read(CHUNK_SIZE)
            if not chunk:
                break

            size += len(chunk)
            for q in queues:
                q.put(chunk)

            now = time.monotonic()
            if total_size and now - last_log >= 10.0:
                pct = size / total_size * 100
                elapsed = now - start
                speed = size / elapsed if elapsed > 0 else 0
                logger.info(
                    "Checksumming: %s / %s (%.1f%%) — %s/s",
                    _format_bytes(size), _format_bytes(total_size), pct, _format_bytes(speed),
                )
                last_log = now
    finally:
        # Signal each *started* worker to exit. Workers that never started
        # don't own a queue consumer, so sending None to their queue would
        # leave the sentinel sitting there but is harmless.
        for t, q in zip(threads, queues, strict=True):
            if t in started:
                q.put(None)
        for t in started:
            t.join()

    if errors:
        raise errors[0]

    return size


async def compute_checksums_async(file_path: str | Path) -> ChecksumResult:
    """
    Compute checksums asynchronously.

    Note: This uses synchronous file I/O in a way that doesn't block the event loop
    for too long by processing in chunks. For truly async file I/O, consider using
    aiofiles, but for CPU-bound hashing, the benefit is minimal.

    Args:
        file_path: Path to the file to compute checksums for.

    Returns:
        ChecksumResult containing all checksums and file size.
    """
    import asyncio

    return await asyncio.to_thread(compute_checksums, file_path)
