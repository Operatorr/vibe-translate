import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Live model benchmark — makes real, paid OpenRouter calls, so it lives in a
// separate config from the hermetic unit suite (vitest.config.ts) and never runs
// under `pnpm test`. Run it with `pnpm bench`; combos come from bench/bench.toml.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '@api': fileURLToPath(new URL('./api', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['bench/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
})
