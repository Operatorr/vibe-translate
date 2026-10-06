import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// Tie the offline shell to its exact build, including chunks not visited yet.
// writeBundle runs after Vite copies public/ and writes the generated assets.
function pwaPrecache(): Plugin {
  let root: string
  let outDir: string
  return {
    name: 'vibe-pwa-precache',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = resolve(root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        .sort()
        .map((file) => `/${file}`)
      const template = readFileSync(resolve(root, 'public/sw.js'), 'utf8')
      const hash = createHash('sha256').update(template)
      for (const file of [
        'index.html',
        ...assets.map((url) => url.slice(1)),
        'manifest.webmanifest',
        'icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-192.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
      ]) {
        hash.update(file).update(readFileSync(resolve(outDir, file)))
      }
      writeFileSync(
        resolve(outDir, 'sw.js'),
        template
          .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
          .replace('/* __BUILD_ASSETS__ */ []', JSON.stringify(assets)),
      )
    },
  }
}

// Wrangler local secrets live in `.dev.vars`. Vite only auto-loads `.env*`,
// so copy VITE_* keys into process.env here — existing process.env wins.
// Skipped for production builds so local-only values never ship in the bundle
// (process.env would also outrank any `.env.production`).
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

export default defineConfig(({ mode }) => {
  if (mode !== 'production') {
    loadViteKeysFromDevVars()
  }

  return {
    plugins: [
      tanstackRouter({
        routesDirectory: './app/routes',
        generatedRouteTree: './app/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
      pwaPrecache(),
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
  }
})
