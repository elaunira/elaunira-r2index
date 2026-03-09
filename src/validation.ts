import { z } from 'zod';

// ============================================================================
// Create/Upsert File Schema
// ============================================================================

export const createFileSchema = z.object({
  bucket: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  subcategory: z.string().max(100).optional(),
  checksum_md5: z.string().length(32).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha1: z.string().length(40).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha256: z.string().length(64).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha512: z.string().length(128).regex(/^[a-f0-9]+$/i).optional(),
  deprecated: z.boolean().optional(),
  deprecation_reason: z.string().max(500).optional(),
  entity: z.string().min(1).max(100),
  extension: z.string().min(1).max(50),
  extra: z.record(z.string(), z.unknown()).optional(),
  media_type: z.string().min(1).max(100),
  metadata_path: z.string().max(500).optional(),
  name: z.string().max(255).optional(),
  remote_filename: z.string().min(1).max(255),
  remote_path: z.string().min(1).max(500),
  remote_version: z.string().min(1).max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

export type CreateFileInput = z.infer<typeof createFileSchema>;

// ============================================================================
// Update File Schema
// ============================================================================

export const updateFileSchema = z.object({
  bucket: z.string().min(1).max(100).optional(),
  category: z.string().min(1).max(100).optional(),
  subcategory: z.string().max(100).optional(),
  checksum_md5: z.string().length(32).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha1: z.string().length(40).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha256: z.string().length(64).regex(/^[a-f0-9]+$/i).optional(),
  checksum_sha512: z.string().length(128).regex(/^[a-f0-9]+$/i).optional(),
  deprecated: z.boolean().optional(),
  deprecation_reason: z.string().max(500).optional(),
  entity: z.string().min(1).max(100).optional(),
  extension: z.string().min(1).max(50).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  media_type: z.string().min(1).max(100).optional(),
  metadata_path: z.string().max(500).optional(),
  name: z.string().max(255).optional(),
  remote_filename: z.string().min(1).max(255).optional(),
  remote_path: z.string().min(1).max(500).optional(),
  remote_version: z.string().min(1).max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;

// ============================================================================
// Delete by Remote Tuple Schema
// ============================================================================

export const deleteByRemoteSchema = z.object({
  bucket: z.string().min(1).max(100),
  remote_filename: z.string().min(1).max(255),
  remote_path: z.string().min(1).max(500),
  remote_version: z.string().min(1).max(100).optional(),
});

export type DeleteByRemoteInput = z.infer<typeof deleteByRemoteSchema>;

// ============================================================================
// Search Params Schema
// ============================================================================

export const searchParamsSchema = z.object({
  bucket: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  deprecated: z.enum(['true', 'false']).optional(),
  entity: z.string().max(100).optional(),
  extension: z.string().max(50).optional(),
  group_by: z.enum(['bucket', 'category', 'subcategory', 'entity', 'extension', 'media_type', 'deprecated']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  media_type: z.string().max(100).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
  tags: z.string().max(500).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

// ============================================================================
// Download Tracking Schema
// ============================================================================

export const createDownloadSchema = z.object({
  bucket: z.string().min(1).max(100),
  remote_path: z.string().min(1).max(500),
  remote_filename: z.string().min(1).max(255),
  remote_version: z.string().min(1).max(100).optional(),
  ip_address: z.string().min(1).max(45), // IPv6 max length
  user_agent: z.string().max(500).optional(),
});

export type CreateDownloadInput = z.infer<typeof createDownloadSchema>;

// ============================================================================
// Analytics Params Schema
// ============================================================================

export const analyticsParamsSchema = z.object({
  start: z.string().regex(/^\d+$/),
  end: z.string().regex(/^\d+$/),
  scale: z.enum(['hour', 'day', 'month']).optional(),
  bucket: z.string().max(100).optional(),
  remote_path: z.string().max(500).optional(),
  remote_filename: z.string().max(255).optional(),
  remote_version: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  entity: z.string().max(100).optional(),
  tags: z.string().max(500).optional(),
  ip: z.string().max(45).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
}).refine(data => parseInt(data.start, 10) <= parseInt(data.end, 10), {
  message: 'start must be less than or equal to end',
  path: ['start'],
});

export type AnalyticsParamsInput = z.infer<typeof analyticsParamsSchema>;
