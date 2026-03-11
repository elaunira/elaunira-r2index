import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.example.jsonc' },
        miniflare: {
          bindings: {
            R2INDEX_READ_TOKEN: 'test-read-token',
            R2INDEX_WRITE_TOKEN: 'test-write-token',
            CACHE_MAX_AGE: '60',
          },
        },
      },
    },
  },
});
