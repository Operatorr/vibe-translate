import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { pwaPrecache } from '../../../build/pwa-precache'

it('builds a complete, versioned offline bundle with one public-asset inventory', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vibe-pwa-build-')))
  const publicAssets = [
    'manifest.webmanifest',
    'icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
  ]
  const template = readFileSync(
    new URL('../../../public/sw.js', import.meta.url),
    'utf8',
  )
  try {
    mkdirSync(join(root, 'public/icons'), { recursive: true })
    writeFileSync(join(root, 'public/sw.js'), template)
    for (const file of publicAssets)
      writeFileSync(join(root, 'public', file), 'fixture')
    writeFileSync(
      join(root, 'index.html'),
      '<div>$&</div><script type="module" src="/main.js"></script>',
    )
    writeFileSync(
      join(root, 'main.js'),
      "import './style.css'; window.loadLazy = () => import('./lazy.js')",
    )
    writeFileSync(join(root, 'lazy.js'), 'export const value = 1')
    writeFileSync(join(root, 'style.css'), 'body { color: red }')
    const run = async () => {
      const output = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [pwaPrecache()],
        build: { sourcemap: true },
      })
      const emitted = (Array.isArray(output) ? output : [output])
        .flatMap((item) => ('output' in item ? item.output : []))
        .map((item) => item.fileName)
        .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        .sort()
      const worker = readFileSync(join(root, 'dist/sw.js'), 'utf8')
      const assets = JSON.parse(
        worker.match(/const BUILD_ASSETS = (.*)/)![1],
      ) as { url: string; integrity: string }[]
      expect(assets.map((asset) => asset.url)).toEqual(
        emitted.map((file) => `/${file}`),
      )
      expect(assets.some((asset) => asset.url.includes('lazy'))).toBe(true)
      for (const asset of assets) {
        const bytes = readFileSync(join(root, 'dist', asset.url.slice(1)))
        expect(asset.integrity).toBe(
          `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
        )
      }
      expect(worker).not.toMatch(/__BUILD_|__OPTIONAL_ASSETS__/)
      expect(JSON.parse(worker.match(/const BUILD_SHELL = (.*)/)![1])).toBe(
        readFileSync(join(root, 'dist/index.html'), 'utf8'),
      )
      expect(
        JSON.parse(worker.match(/const OPTIONAL_ASSETS = (.*)/)![1]),
      ).toEqual(publicAssets.map((file) => `/${file}`))
      return worker.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}([^`]+)`/)![1]
    }
    let version = await run()
    for (const [file, content] of [
      [
        'index.html',
        '<div>changed $&</div><script type="module" src="/main.js"></script>',
      ],
      ['lazy.js', 'export const value = 2'],
      ['public/icons/icon-192.png', 'changed icon'],
      ['public/sw.js', template + '\n// changed worker\n'],
    ]) {
      writeFileSync(join(root, file), content)
      const next = await run()
      expect(next).not.toBe(version)
      version = next
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
