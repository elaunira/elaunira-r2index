export interface ApiErrorBody {
  code: string;
  details?: unknown;
  message: string;
  resolution: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

const e = (code: string, message: string, resolution: string): ApiErrorResponse => ({
  error: { code, message, resolution }
});

export const Errors = {
  // Authentication
  INVALID_AUTH_FORMAT: e(
    'INVALID_AUTH_FORMAT',
    'Authorization header format is invalid.',
    'Use the Bearer token format: Authorization: Bearer <token>'
  ),
  INVALID_TOKEN: e(
    'INVALID_TOKEN',
    'The provided API token is invalid.',
    'Check your API token and try again.'
  ),
  MISSING_AUTH_HEADER: e(
    'MISSING_AUTH_HEADER',
    'Authorization header is missing.',
    'Add the Authorization header with a Bearer token: Authorization: Bearer <token>'
  ),

  // General errors
  INTERNAL_ERROR: e(
    'INTERNAL_ERROR',
    'An internal server error occurred.',
    'Try again later or contact support if the issue persists.'
  ),
  NOT_FOUND: e(
    'NOT_FOUND',
    'The requested resource was not found.',
    'Check the URL and try again.'
  ),
  RATE_LIMITED: e(
    'RATE_LIMITED',
    'Too many requests.',
    'Please slow down and try again later.'
  ),
  REQUEST_TOO_LARGE: e(
    'REQUEST_TOO_LARGE',
    'Request body is too large.',
    'Reduce the size of your request body.'
  ),

  // Resource errors
  DUPLICATE_REMOTE_TUPLE: e(
    'DUPLICATE_REMOTE_TUPLE',
    'A file with this remote_path, remote_filename, and remote_version already exists.',
    'Use a different remote_version or update the existing file.'
  ),
  FILE_NOT_FOUND: e(
    'FILE_NOT_FOUND',
    'The requested file was not found.',
    'Verify the file ID or remote tuple exists.'
  ),
  R2_BUCKET_NOT_BOUND: e(
    'R2_BUCKET_NOT_BOUND',
    'No R2 binding found for the specified bucket.',
    'Add an R2 bucket binding in your wrangler configuration. The binding name must be the bucket name uppercased with hyphens replaced by underscores (e.g., bucket "my-assets" requires binding "MY_ASSETS").'
  ),
  R2_OBJECT_NOT_FOUND: e(
    'R2_OBJECT_NOT_FOUND',
    'The file object was not found in storage.',
    'The file metadata exists but the object is missing from R2.'
  ),
  MISSING_REMOTE_TUPLE: e(
    'MISSING_REMOTE_TUPLE',
    'Missing required fields for delete operation.',
    'Provide remote_path, remote_filename, and remote_version in the request body.'
  ),

  // Validation
  INVALID_GROUP_BY: e(
    'INVALID_GROUP_BY',
    'The group_by field is invalid.',
    'Use one of: category, entity, extension, media_type, deprecated.'
  ),
  INVALID_JSON: e(
    'INVALID_JSON',
    'The request body contains invalid JSON.',
    'Ensure the request body is valid JSON.'
  ),
  MISSING_REQUIRED_FIELDS: e(
    'MISSING_REQUIRED_FIELDS',
    'One or more required fields are missing.',
    'Ensure all required fields are provided: category, entity, extension, media_type, remote_path, remote_filename, remote_version.'
  ),
  VALIDATION_ERROR: e(
    'VALIDATION_ERROR',
    'Request validation failed.',
    'Check the error details for specific field errors.'
  ),
} as const;

export function validationError(details: unknown): ApiErrorResponse {
  return {
    error: {
      ...Errors.VALIDATION_ERROR.error,
      details,
    },
  };
}
