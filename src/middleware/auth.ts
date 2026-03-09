import { Context, Next } from 'hono';
import type { Env } from '../types';
import { Errors } from '../errors';

function validateToken(c: Context<{ Bindings: Env }>, expectedToken: string): ReturnType<typeof c.json> | null {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(Errors.MISSING_AUTH_HEADER, 401);
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return c.json(Errors.INVALID_AUTH_FORMAT, 401);
  }

  if (token !== expectedToken) {
    return c.json(Errors.INVALID_TOKEN, 403);
  }

  return null;
}

export async function readAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const readToken = c.env.R2INDEX_READ_TOKEN;

  // If no read token is configured, read operations are public
  if (!readToken) {
    await next();
    return;
  }

  // Accept either the read token or the write token for read operations
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(Errors.MISSING_AUTH_HEADER, 401);
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return c.json(Errors.INVALID_AUTH_FORMAT, 401);
  }

  if (token !== readToken && token !== c.env.R2INDEX_WRITE_TOKEN) {
    return c.json(Errors.INVALID_TOKEN, 403);
  }

  await next();
}

export async function writeAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const error = validateToken(c, c.env.R2INDEX_WRITE_TOKEN);
  if (error) return error;

  await next();
}
