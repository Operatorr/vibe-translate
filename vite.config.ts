import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Wrangler local secrets live in `.dev.vars`. Vite only auto-loads `.env*`,
// so copy VITE_* keys into process.env here — existing process.env wins.
function loadViteKeysFromDevVars() {
  const file = fileURLToPath(new URL('./.dev.vars', import.meta.url))
  if (!existsSync(file)) {
    return
  }

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }

    const key = line.slice(0, eq).trim()
    if (!key.startsWith('VITE_') || process.env[key] !== undefined) {
      continue
    }

    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadViteKeysFromDevVars()

export default defineConfig({
  plugins: [
    tanstackRouter({
      routesDirectory: './app/routes',
      generatedRouteTree: './app/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '@api': fileURLToPath(new URL('./api', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
