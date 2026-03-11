# R2 Index

A queryable metadata index for files stored in Cloudflare R2. Built as a Cloudflare Worker with D1 database, it enables searching, filtering, and organizing files by category, entity, tags, and custom metadata — without scanning the object store.

## Architecture

```
Client (Airflow, etc.)
    │
    ├─► Worker API ─► D1 (metadata CRUD/search/analytics)
    │                  │
    │                  └─► R2 (file streaming via /download endpoint)
    │
    └─► R2 (direct upload via S3-compatible API)
```

The Worker handles metadata indexing, download tracking with analytics, and file streaming from R2. File uploads go directly to R2 using the S3-compatible API.

## Who uses it?

<table>
<tr>
<td align="center"><a href="https://ipregistry.co" target="_blank" rel="noopener noreferrer"><img src="https://avatars.githubusercontent.com/u/48379573?v=4" width="64" /></a></td>
<td align="center"><a href="https://noticeable.io" target="_blank" rel="noopener noreferrer"><img src="https://avatars.githubusercontent.com/u/32177975?v=4" width="64" /></a></td>
<td align="center"><a href="https://openplanetdata.com" target="_blank" rel="noopener noreferrer"><img src="https://avatars.githubusercontent.com/u/214255256?v=4" width="64" /></a></td>
</tr>
<tr>
<td align="center">Ipregistry</td>
<td align="center">Noticeable</td>
<td align="center">OpenPlanetData</td>
</tr>
</table>

## Deploy as a Dependency

The recommended way to deploy R2 Index is to install it as an npm dependency in your own project. This lets each project have its own `wrangler.jsonc` with project-specific bindings (D1 database, R2 bucket, routes, secrets).

### 1. Create your project

```bash
mkdir my-r2index && cd my-r2index
npm init -y
```

### 2. Configure npm for GitHub Packages

Create `.npmrc`:

```
@elaunira:registry=https://npm.pkg.github.com
```

### 3. Install the package

```bash
npm install @elaunira/r2index
```

### 4. Create the entry point

Create `src/index.ts`:

```ts
export { default } from '@elaunira/r2index';
```

### 5. Create your `wrangler.jsonc`

Use [`wrangler.example.jsonc`](wrangler.example.jsonc) as a reference:

```jsonc
{
  "name": "my-r2index",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-31",
  "routes": [
    { "pattern": "r2index.mydomain.com/*", "zone_name": "mydomain.com" }
  ],
  "d1_databases": [
    {
      "binding": "D1",
      "database_name": "my-r2index",
      "database_id": "<YOUR_D1_DATABASE_ID>"
    }
  ],
  "r2_buckets": [
    { "binding": "R2", "bucket_name": "my-bucket" }
  ],
  "vars": {
    "CACHE_MAX_AGE": "60",
    "DOWNLOADS_RETENTION_DAYS": "365"
  }
}
```

### 6. Create D1 database and apply migrations

```bash
wrangler d1 create my-r2index
# Update wrangler.jsonc with the returned database_id

# Apply migrations from the package
wrangler d1 migrations apply my-r2index --remote \
  --migrations-dir node_modules/@elaunira/r2index/migrations
```

### 7. Set API tokens

```bash
# Required: token for write operations (create, update, delete)
wrangler secret put R2INDEX_WRITE_TOKEN

# Optional: token for read operations (if unset, read operations are public)
wrangler secret put R2INDEX_READ_TOKEN
```

### 8. Deploy

```bash
wrangler deploy
```

## Standalone Setup

If you prefer to clone and deploy directly:

```bash
git clone https://github.com/elaunira/elaunira-r2index.git
cd elaunira-r2index
npm install
cp wrangler.example.jsonc wrangler.jsonc
# Edit wrangler.jsonc with your D1 database ID, R2 bucket, and routes
wrangler d1 create r2index
npm run db:migrate
wrangler secret put R2INDEX_WRITE_TOKEN
npm run deploy
```

## Configuration

See [`wrangler.example.jsonc`](wrangler.example.jsonc) for the full configuration.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_MAX_AGE` | Cache-Control max-age in seconds. Set to `-1` to disable caching globally. | `60` |
| `DOWNLOADS_RETENTION_DAYS` | Days to keep download records before cleanup | `365` |
| `R2INDEX_WRITE_TOKEN` | Bearer token for write operations (set via `wrangler secret put`) | Required |
| `R2INDEX_READ_TOKEN` | Bearer token for read operations (set via `wrangler secret put`). If unset, read operations are public. The write token also grants read access. | Optional |

### Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `D1` | D1 Database | Metadata storage |
| `R2` | R2 Bucket | File storage (used by `/download` endpoint) |

### Caching

All GET responses include a `Cache-Control` header. You can disable caching:
- **Globally:** Set `CACHE_MAX_AGE=-1` to disable for all responses
- **Per-request:** Add `?cache=false` to any GET request

## Data Model

### Core Fields

| Field | Description | Example |
|-------|-------------|---------|
| `category` | Product or service grouping | `acme` |
| `subcategory` | Sub-grouping within a category | `countries`, `regions` |
| `entity` | Specific dataset identifier | `acme-abuser`, `acme-geolocation` |
| `extension` | File format | `csv`, `csv.zip`, `mmdb` |
| `media_type` | MIME type | `text/csv`, `application/zip` |
| `name` | Human-readable name | `Abuser`, `Geolocation` |

### Remote Location (Unique Constraint)

The tuple `(bucket, remote_path, remote_filename, remote_version)` uniquely identifies a file in R2:

| Field | Description | Example |
|-------|-------------|---------|
| `bucket` | S3/R2 bucket name | `my-bucket` |
| `remote_path` | Directory path in R2 | `acme/abuser` |
| `remote_filename` | File name in R2 | `abuser.csv` |
| `remote_version` | Version identifier | `2026-02-03`, `v1` |

### Optional Metadata

| Field | Description |
|-------|-------------|
| `checksum_md5` | MD5 hash |
| `checksum_sha1` | SHA1 hash |
| `checksum_sha256` | SHA256 hash |
| `checksum_sha512` | SHA512 hash |
| `deprecated` | Boolean flag |
| `deprecation_reason` | Reason for deprecation |
| `extra` | Arbitrary JSON (e.g., `header_line`, `line_count`) |
| `metadata_path` | Path to associated metadata file |
| `size` | File size in bytes |
| `tags` | Array of tags for filtering |

## API Reference

Authentication uses split tokens:
- **Read operations** (GET): Require `R2INDEX_READ_TOKEN`. If unset, read operations are public. The write token also grants read access.
- **Write operations** (POST, PUT, DELETE): Always require `R2INDEX_WRITE_TOKEN`.

Pass the token via `Authorization: Bearer <token>` header.

### D1 Read Replication (Sessions API)

All database interactions use the D1 Sessions API for sequential consistency. Clients can pass the `X-D1-Bookmark` response header from a previous request as a request header on subsequent calls to ensure read-after-write consistency across requests.

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-D1-Bookmark` | Request | Optional bookmark from a previous response |
| `X-D1-Bookmark` | Response | Bookmark reflecting the latest database state |

### Health Check

```
GET /health
```

Returns `{ "status": "ok" }`. No authentication required.

### Create/Update File (Upsert)

```
POST /files
```

Creates or updates a file based on the unique constraint `(bucket, remote_path, remote_filename, remote_version)`.

**Request Body:**

```json
{
  "bucket": "my-bucket",
  "category": "acme",
  "subcategory": null,
  "entity": "acme-abuser",
  "extension": "csv",
  "media_type": "text/csv",
  "name": "Abuser",
  "remote_path": "acme/abuser",
  "remote_filename": "abuser.csv",
  "remote_version": "2026-02-03",
  "size": 5023465,
  "checksum_md5": "21a165f3ddef92b90dccb0c1bb4e249f",
  "checksum_sha1": "b588c39c691a2bc2cdd81e9f826ae9b5eb163e39",
  "checksum_sha256": "8dac526e40c250f3ad117d05452e04814e2c979754a2e4810d8f85413d188ba6",
  "checksum_sha512": "0f4bdedf66e5ec214aa1302d624913c2137c9cbfe1f81c0a63138c9ddd69d0c0",
  "extra": {
    "header_line": "# ip_start,ip_end",
    "line_count": 169964
  },
  "tags": ["ip", "security"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | S3/R2 bucket name |
| `category` | string | Yes | Product or service grouping (e.g., `acme`) |
| `subcategory` | string | No | Sub-grouping within a category (e.g., `countries`) |
| `checksum_md5` | string | No | MD5 hash |
| `checksum_sha1` | string | No | SHA1 hash |
| `checksum_sha256` | string | No | SHA256 hash |
| `checksum_sha512` | string | No | SHA512 hash |
| `entity` | string | Yes | Dataset identifier (e.g., `acme-abuser`) |
| `extension` | string | Yes | File format (e.g., `csv`, `mmdb`) |
| `extra` | object | No | Arbitrary JSON (merged into nested index output) |
| `media_type` | string | Yes | MIME type (e.g., `text/csv`) |
| `metadata_path` | string | No | Path to associated metadata file |
| `name` | string | No | Human-readable name (e.g., `Abuser`) |
| `remote_filename` | string | Yes | Filename in R2 |
| `remote_path` | string | Yes | Directory path in R2 |
| `remote_version` | string | Yes | Version identifier (e.g., `2026-02-03`) |
| `size` | integer | No | File size in bytes |
| `tags` | string[] | No | Tags for filtering |

**Response:** `201 Created` (new) or `200 OK` (updated) with file record (includes auto-generated `id`).

### Get File

```
GET /files/:id
```

**Response:** `200 OK` with file record or `404 Not Found`.

### Get File by Remote Tuple

```
GET /files/by-tuple
```

Retrieves a file by its unique remote tuple.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bucket` | string | Yes | S3/R2 bucket name |
| `remote_path` | string | Yes | Directory path in R2 |
| `remote_filename` | string | Yes | Filename in R2 |
| `remote_version` | string | Yes | Version identifier |

**Example Request:**

```bash
curl "https://r2index.acme.com/files/by-tuple?bucket=my-bucket&remote_path=acme/abuser&remote_filename=abuser.csv&remote_version=2026-02-03"
```

**Response:** `200 OK` with file record or `404 Not Found`.

### Update File

```
PUT /files/:id
```

**Request Body:** Any subset of file fields to update.

**Response:** `200 OK` with updated file record.

### Delete File by ID

```
DELETE /files/:id
```

Removes file metadata from the index. Does **not** delete the actual file in R2.

**Response:** `200 OK` with `{ "success": true }` or `404 Not Found`.

### Delete File by Remote Tuple

```
DELETE /files
```

Removes file metadata from the index. Does **not** delete the actual file in R2.

**Request Body:**

```json
{
  "bucket": "my-bucket",
  "remote_path": "acme/abuser",
  "remote_filename": "abuser.csv",
  "remote_version": "2026-02-03"
}
```

**Response:** `200 OK` with `{ "success": true }` or `404 Not Found`.

### Search Files

```
GET /files
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bucket` | string | Filter by bucket (exact match) |
| `category` | string | Filter by category (exact match) |
| `subcategory` | string | Filter by subcategory (exact match) |
| `deprecated` | boolean | Filter by deprecated status (`true` or `false`) |
| `entity` | string | Filter by entity (exact match) |
| `extension` | string | Filter by extension (exact match) |
| `limit` | integer | Max results (default: 100, max: 1000) |
| `media_type` | string | Filter by media type (exact match) |
| `offset` | integer | Pagination offset (default: 0) |
| `tags` | string | Filter by tags (comma-separated, must have ALL) |
| `group_by` | string | Group results by field: `bucket`, `category`, `subcategory`, `entity`, `extension`, `media_type`, `deprecated` |

**Example Requests:**

```bash
# Get all files
curl "https://r2index.acme.com/files"

# Filter by category
curl "https://r2index.acme.com/files?category=acme"

# Filter by category and entity
curl "https://r2index.acme.com/files?category=acme&entity=acme-abuser"

# Filter by extension
curl "https://r2index.acme.com/files?extension=csv"

# Filter by tags (must have ALL specified tags)
curl "https://r2index.acme.com/files?tags=ip,security"

# Filter non-deprecated files only
curl "https://r2index.acme.com/files?deprecated=false"

# Combine filters with pagination
curl "https://r2index.acme.com/files?category=acme&extension=csv&limit=50&offset=0"

# Group by extension for a given category
curl "https://r2index.acme.com/files?category=acme&group_by=extension"
```

**Grouped Response (when using `group_by`):**

```json
{
  "groups": [
    { "value": "csv", "count": 14 },
    { "value": "csv.zip", "count": 14 },
    { "value": "mmdb", "count": 14 }
  ],
  "total": 42
}
```

**Response:**

```json
{
  "files": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "bucket": "my-bucket",
      "name": "Abuser",
      "category": "acme",
      "subcategory": null,
      "entity": "acme-abuser",
      "extension": "csv",
      "media_type": "text/csv",
      "remote_path": "acme/abuser",
      "remote_filename": "abuser.csv",
      "remote_version": "2026-02-03",
      "metadata_path": null,
      "size": 5023465,
      "checksum_md5": "21a165f3ddef92b90dccb0c1bb4e249f",
      "checksum_sha1": "b588c39c691a2bc2cdd81e9f826ae9b5eb163e39",
      "checksum_sha256": "8dac526e40c250f3ad117d05452e04814e2c979754a2e4810d8f85413d188ba6",
      "checksum_sha512": "0f4bdedf66e5ec214aa1302d624913c2137c9cbfe1f81c0a63138c9ddd69d0c0",
      "extra": {
        "header_line": "# ip_start,ip_end",
        "line_count": 169964
      },
      "deprecated": false,
      "deprecation_reason": "",
      "created": 1706918150000,
      "updated": 1706918150000,
      "tags": ["ip", "security"]
    }
  ],
  "total": 1
}
```

### Get Nested Index

```
GET /files/index
```

Returns files grouped by entity then by extension in a nested structure. Useful for generating compatibility indexes.

**Query Parameters:** Same filters as Search Files, plus `limit` (default: 100, max: 1000) and `offset` (default: 0) for pagination.

**Example Request:**

```bash
curl "https://r2index.acme.com/files/index?category=acme&limit=100&offset=0"
```

**Response:**

```json
{
  "index": {
    "acme-abuser": {
      "csv": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "bucket": "my-bucket",
        "category": "acme",
        "subcategory": null,
        "entity": "acme-abuser",
        "extension": "csv",
        "name": "Abuser",
        "media_type": "text/csv",
        "checksums": {
          "md5": "21a165f3ddef92b90dccb0c1bb4e249f",
          "sha256": "8dac526e40c250f3ad117d05452e04814e2c979754a2e4810d8f85413d188ba6"
        },
        "file_size": "5023465",
        "remote_path": "acme/abuser",
        "remote_filename": "abuser.csv",
        "remote_version": "2026-02-03",
        "metadata_path": null,
        "deprecated": false,
        "deprecation_reason": "",
        "tags": ["ip", "security"],
        "extra": {
          "header_line": "# ip_start,ip_end",
          "line_count": 169964
        },
        "created": "2026-02-03T18:55:50.000Z",
        "last_updated": "2026-02-03T18:55:50.000Z"
      }
    }
  },
  "total": 42
}
```

### Download File

```
GET /download/:id
GET /download?bucket=...&remote_path=...&remote_filename=...&remote_version=...
```

Streams a file from R2, records a download event for analytics, and returns the file content.

**By ID:**

```bash
curl "https://r2index.acme.com/download/550e8400-e29b-41d4-a716-446655440000"
```

**By Remote Tuple:**

```bash
curl "https://r2index.acme.com/download?bucket=my-bucket&remote_path=acme/abuser&remote_filename=abuser.csv&remote_version=2026-02-03"
```

**Response:** File content with appropriate `Content-Type`, `Content-Length`, `Content-Disposition`, and `ETag` headers.

Returns `404` if the file metadata or R2 object is not found.

### Record Download

```
POST /downloads
```

Records a file download event for analytics tracking.

**Request Body:**

```json
{
  "bucket": "my-bucket",
  "remote_path": "acme/abuser",
  "remote_filename": "abuser.csv",
  "remote_version": "2026-02-03",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | S3/R2 bucket name |
| `ip_address` | string | Yes | Client IP address (IPv4 or IPv6) |
| `remote_filename` | string | Yes | File name in R2 |
| `remote_path` | string | Yes | Directory path in R2 |
| `remote_version` | string | Yes | Version identifier |
| `user_agent` | string | No | Client user agent string |

**Example Request:**

```bash
curl -X POST "https://r2index.acme.com/downloads" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "remote_path": "acme/abuser",
    "remote_filename": "abuser.csv",
    "remote_version": "2026-02-03",
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
  }'
```

**Response:** `201 Created` with download record including pre-computed time buckets.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "bucket": "my-bucket",
  "remote_path": "acme/abuser",
  "remote_filename": "abuser.csv",
  "remote_version": "2026-02-03",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
  "downloaded_at": 1706918150000,
  "hour_bucket": 1706914800000,
  "day_bucket": 1706832000000,
  "month_bucket": 202402
}
```

### Analytics: Time Series

```
GET /analytics/timeseries
```

Returns download counts over time, grouped by hour, day, or month.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bucket` | string | No | Filter by bucket |
| `category` | string | No | Filter by file category (requires JOIN with files table) |
| `end` | integer | Yes | End timestamp (ms) |
| `entity` | string | No | Filter by file entity (requires JOIN with files table) |
| `limit` | integer | No | Max files per bucket (default: 100, max: 1000) |
| `remote_filename` | string | No | Filter by remote filename |
| `remote_path` | string | No | Filter by remote path |
| `remote_version` | string | No | Filter by remote version |
| `scale` | string | No | Time bucket: `hour`, `day`, `month` (default: `day`) |
| `start` | integer | Yes | Start timestamp (ms) |
| `subcategory` | string | No | Filter by file subcategory (requires JOIN with files table) |
| `tags` | string | No | Filter by file tags (comma-separated, must have ALL; requires JOIN) |

**Example Request:**

```bash
curl "https://r2index.acme.com/analytics/timeseries?start=1704067200000&end=1706745600000&scale=day"
```

**Response:**

```json
{
  "scale": "day",
  "buckets": [
    {
      "timestamp": 1704067200000,
      "files": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440000",
          "bucket": "my-bucket",
          "remote_path": "acme/abuser",
          "remote_filename": "abuser.csv",
          "remote_version": "2026-02-03",
          "downloads": 100,
          "unique_downloads": 30
        },
        {
          "id": "550e8400-e29b-41d4-a716-446655440001",
          "bucket": "my-bucket",
          "remote_path": "acme/geolocation",
          "remote_filename": "geolocation.mmdb",
          "remote_version": "2026-02-03",
          "downloads": 50,
          "unique_downloads": 15
        }
      ],
      "total_downloads": 150,
      "total_unique_downloads": 45
    }
  ],
  "period": { "start": 1704067200000, "end": 1706745600000 }
}
```

- `timestamp`: Start of the time bucket (e.g., for `scale=day`, midnight UTC of that day; for `scale=month`, YYYYMM integer like `202401`)
- `id`: File ID from the index (null if file not in index)

### Analytics: Summary

```
GET /analytics/summary
```

Returns aggregate statistics for a time period.

**Query Parameters:** Same as Time Series (`start`, `end`, `bucket`, `remote_path`, `remote_filename`, `remote_version`, `category`, `subcategory`, `entity`, `tags`).

**Example Requests:**

```bash
# Overall summary
curl "https://r2index.acme.com/analytics/summary?start=1704067200000&end=1706745600000"

# Summary for a specific category
curl "https://r2index.acme.com/analytics/summary?start=1704067200000&end=1706745600000&category=boundaries&subcategory=countries"
```

**Response:**

```json
{
  "total_downloads": 1234,
  "unique_downloads": 567,
  "top_user_agents": [
    { "user_agent": "Chrome/120", "downloads": 500 },
    { "user_agent": "Safari/17", "downloads": 300 }
  ],
  "period": { "start": 1704067200000, "end": 1706745600000 }
}
```

### Analytics: By IP

```
GET /analytics/by-ip
```

Returns downloads for a specific IP address.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `end` | integer | Yes | End timestamp (ms) |
| `ip` | string | Yes | IP address to search |
| `limit` | integer | No | Max results (default: 100, max: 1000) |
| `offset` | integer | No | Pagination offset |
| `start` | integer | Yes | Start timestamp (ms) |

**Example Request:**

```bash
curl "https://r2index.acme.com/analytics/by-ip?ip=192.168.1.1&start=1704067200000&end=1706745600000"
```

**Response:**

```json
{
  "downloads": [
    {
      "bucket": "my-bucket",
      "remote_path": "acme/abuser",
      "remote_filename": "abuser.csv",
      "remote_version": "2026-02-03",
      "downloaded_at": 1704067200000,
      "user_agent": "Chrome/120"
    }
  ],
  "total": 45
}
```

### Analytics: User Agents

```
GET /analytics/user-agents
```

Returns download statistics grouped by user agent.

**Query Parameters:** Same as Time Series (`start`, `end`, all file filters), plus `limit` (default: 20, max: 100).

**Example Request:**

```bash
curl "https://r2index.acme.com/analytics/user-agents?start=1704067200000&end=1706745600000&limit=10"
```

**Response:**

```json
{
  "user_agents": [
    { "user_agent": "Chrome/120", "downloads": 500, "unique_ips": 234 },
    { "user_agent": "Safari/17", "downloads": 300, "unique_ips": 156 }
  ],
  "period": { "start": 1704067200000, "end": 1706745600000 }
}
```

### Analytics: Top Files

```
GET /analytics/top-files
```

Returns files ranked by total or unique download count within a time period.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | integer | Yes | Start timestamp (ms) |
| `end` | integer | Yes | End timestamp (ms) |
| `sort_by` | string | No | `downloads` (default) or `unique_downloads` |
| `limit` | integer | No | Max results (default: 100, max: 1000) |
| `offset` | integer | No | Pagination offset (default: 0) |
| `bucket` | string | No | Filter by bucket |
| `category` | string | No | Filter by file category |
| `subcategory` | string | No | Filter by file subcategory |
| `entity` | string | No | Filter by file entity |
| `tags` | string | No | Filter by file tags (comma-separated, must have ALL) |

**Example Requests:**

```bash
# Top downloaded files overall
curl "https://r2index.acme.com/analytics/top-files?start=1704067200000&end=1706745600000"

# Top files by unique downloads for a category
curl "https://r2index.acme.com/analytics/top-files?start=1704067200000&end=1706745600000&sort_by=unique_downloads&category=boundaries&subcategory=countries"
```

**Response:**

```json
{
  "files": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "bucket": "my-bucket",
      "remote_path": "geo/boundaries",
      "remote_filename": "france.geojson",
      "remote_version": "v1",
      "downloads": 1542,
      "unique_downloads": 983
    }
  ],
  "total": 250,
  "period": { "start": 1704067200000, "end": 1706745600000 }
}
```

### Analytics: Per-File Download Counts

```
GET /analytics/file/:id/downloads
```

Returns download counts for a single file, grouped by time bucket.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | integer | Yes | Start timestamp (ms) |
| `end` | integer | Yes | End timestamp (ms) |
| `scale` | string | No | Time bucket: `hour`, `day`, `month` (default: `day`) |

**Example Request:**

```bash
curl "https://r2index.acme.com/analytics/file/550e8400-e29b-41d4-a716-446655440000/downloads?start=1704067200000&end=1706745600000&scale=day"
```

**Response:**

```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "buckets": [
    { "timestamp": 1704067200000, "downloads": 45, "unique_downloads": 30 },
    { "timestamp": 1704153600000, "downloads": 52, "unique_downloads": 38 }
  ],
  "total_downloads": 97,
  "total_unique_downloads": 68,
  "period": { "start": 1704067200000, "end": 1706745600000 },
  "scale": "day"
}
```

Returns `404` if the file does not exist.

### Maintenance: Cleanup Downloads

```
POST /maintenance/cleanup-downloads
```

Deletes download records older than `DOWNLOADS_RETENTION_DAYS` (default: 365 days). Call this endpoint periodically (e.g., daily via cron or Cloudflare Cron Triggers) to keep the database size manageable.

**Example Request:**

```bash
curl -X POST "https://r2index.acme.com/maintenance/cleanup-downloads" \
  -H "Authorization: Bearer <token>"
```

**Response:**

```json
{
  "deleted_count": 1234,
  "retention_days": 365
}
```

**Cloudflare Cron Trigger Example:**

Add to your `wrangler.jsonc`:

```jsonc
{
  "triggers": {
    "crons": ["0 2 * * *"]  // Run daily at 2 AM UTC
  }
}
```

Then handle the scheduled event in your worker:

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const deleted = await cleanupOldDownloads(env.DB, parseInt(env.DOWNLOADS_RETENTION_DAYS || '365', 10));
    console.log(`Cleanup: deleted ${deleted} old download records`);
  },
  // ... fetch handler
};
```

## Database Schema

### files

| Column | Type | Description |
|--------|------|-------------|
| `bucket` | TEXT | S3/R2 bucket name |
| `category` | TEXT | File category |
| `subcategory` | TEXT | File subcategory |
| `checksum_md5` | TEXT | MD5 checksum |
| `checksum_sha1` | TEXT | SHA1 checksum |
| `checksum_sha256` | TEXT | SHA256 checksum |
| `checksum_sha512` | TEXT | SHA512 checksum |
| `created` | INTEGER | Creation timestamp (ms) |
| `deprecated` | INTEGER | Deprecation flag (returns as boolean) |
| `deprecation_reason` | TEXT | Reason for deprecation |
| `entity` | TEXT | Entity type |
| `extension` | TEXT | File extension |
| `extra` | TEXT | JSON metadata |
| `id` | TEXT | Primary key (auto-generated UUID) |
| `media_type` | TEXT | MIME type |
| `metadata_path` | TEXT | Path to metadata file |
| `name` | TEXT | Human-readable name |
| `remote_filename` | TEXT | Filename in R2 |
| `remote_path` | TEXT | Path in R2 bucket |
| `remote_version` | TEXT | Version identifier |
| `size` | INTEGER | File size in bytes |
| `updated` | INTEGER | Last update timestamp (ms) |

**Unique Constraint:** `(bucket, remote_path, remote_filename, remote_version)`

### file_tags

| Column | Type | Description |
|--------|------|-------------|
| `file_id` | TEXT | Foreign key to files.id |
| `tag` | TEXT | Tag value |

**Primary Key:** `(file_id, tag)`

### file_downloads

| Column | Type | Description |
|--------|------|-------------|
| `bucket` | TEXT | S3/R2 bucket name |
| `day_bucket` | INTEGER | Pre-computed day bucket for fast aggregation |
| `downloaded_at` | INTEGER | Download timestamp (ms) |
| `hour_bucket` | INTEGER | Pre-computed hour bucket for fast aggregation |
| `id` | TEXT | Primary key (auto-generated UUID) |
| `ip_address` | TEXT | Client IP address |
| `month_bucket` | INTEGER | Pre-computed month bucket (YYYYMM format) |
| `remote_filename` | TEXT | Filename in R2 |
| `remote_path` | TEXT | Path in R2 bucket |
| `remote_version` | TEXT | Version identifier |
| `user_agent` | TEXT | Client user agent |

**Indexes:**
- Time bucket range scans: `(hour_bucket)`, `(day_bucket)`, `(month_bucket)`
- Time-first composite (global analytics): `(day_bucket, bucket, remote_path, remote_filename, remote_version)`, etc.
- File-first composite (per-file lookups): `(bucket, remote_path, remote_filename, remote_version, day_bucket)`, etc.
- IP lookups: `(ip_address, day_bucket)`

## Development

```bash
# Copy the example config for local development
cp wrangler.example.jsonc wrangler.jsonc

# Run locally
npm run dev

# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Deploy
npm run deploy

# Run e2e tests (API only)
python e2e_test.py <api_url> <api_token>

# Run e2e tests with R2 upload/download (includes 5GB large file test)
python e2e_test.py <api_url> <api_token> <r2_access_key_id> <r2_secret_access_key> <r2_account_id>
```

### E2E Tests with Bao

```bash
# API-only e2e tests
python e2e_test.py \
  $(bao kv get -field=api-url -namespace=elaunira/production kv/cloudflare/r2index) \
  $(bao kv get -field=api-token -namespace=elaunira/production kv/cloudflare/r2index)

# Full e2e tests including R2 upload/download and 5GB large file test
python e2e_test.py \
  $(bao kv get -field=api-url -namespace=elaunira/production kv/cloudflare/r2index) \
  $(bao kv get -field=api-token -namespace=elaunira/production kv/cloudflare/r2index) \
  $(bao kv get -field=access-key-id -namespace=elaunira/production kv/cloudflare/r2/e2e-tests) \
  $(bao kv get -field=secret-access-key -namespace=elaunira/production kv/cloudflare/r2/e2e-tests) \
  $(bao kv get -field=account-id -namespace=elaunira/production kv/cloudflare/r2/e2e-tests)
```

## License

MIT
