import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Worker-side unit tests run in Node with no SPA plugins. They cover the pure
// helpers (prompt construction, response parsing, call-target resolution) that
// power the translate flow — see api/_lib/__tests__/.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '@api': fileURLToPath(new URL('./api', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // app/lib holds the SPA's pure helpers (cache updaters, alignment, export).
    // Component tests opt into jsdom per file with `@vitest-environment jsdom`.
    include: [
      'api/**/*.test.ts',
      'app/lib/**/*.test.ts',
      'app/components/**/*.test.tsx',
    ],
  },
})
