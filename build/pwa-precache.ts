import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const optionalAssets = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

// Embed the exact HTML and verify asset bytes, even across deployment changes.
export function pwaPrecache(): Plugin {
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
        .map((file) => {
          const bytes = readFileSync(resolve(outDir, file))
          return {
            url: `/${file}`,
            integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
          }
        })
      const template = readFileSync(resolve(root, 'public/sw.js'), 'utf8')
      const shell = readFileSync(resolve(outDir, 'index.html'), 'utf8')
      const hash = createHash('sha256').update(template).update(shell)
      hash.update(JSON.stringify(assets))
      for (const url of optionalAssets) {
        hash.update(url).update(readFileSync(resolve(outDir, url.slice(1))))
      }
      writeFileSync(
        resolve(outDir, 'sw.js'),
        template
          .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
          .replace('/* __BUILD_ASSETS__ */ []', () => JSON.stringify(assets))
          .replace("/* __BUILD_SHELL__ */ ''", () => JSON.stringify(shell))
          .replace('/* __OPTIONAL_ASSETS__ */ []', () =>
            JSON.stringify(optionalAssets),
          ),
      )
    },
  }
}
