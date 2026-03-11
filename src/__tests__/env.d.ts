import type { Env } from '../types';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options?: { query?: string; import?: string; eager?: boolean },
    ): Record<string, T>;
  }
}
