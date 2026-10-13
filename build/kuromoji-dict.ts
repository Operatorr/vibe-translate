import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

// Ships the kuromoji dictionary (Japanese Kana readings, app/lib/readings.ts)
// under /dict/kuromoji-<version>/. It stays out of /assets/ on purpose: the
// service worker precaches every /assets/ file on install, and only learners
// who toggle Kana should download ~17 MB. The versioned path keeps the
// worker's long-lived dictionary cache correct across package upgrades.
export function kuromojiDict(): Plugin {
  const pkgRoot = resolve(
    dirname(createRequire(import.meta.url).resolve('@patdx/kuromoji')),
    '..',
  )
  const dictDir = join(pkgRoot, 'dict')
  const { version } = JSON.parse(
    readFileSync(join(pkgRoot, 'package.json'), 'utf8'),
  ) as { version: string }
  const base = `/dict/kuromoji-${version}/`
  const files = readdirSync(dictDir).filter((file) => file.endsWith('.dat.gz'))

  return {
    name: 'vibe-kuromoji-dict',
    config: () => ({
      define: { __KUROMOJI_DICT_URL__: JSON.stringify(base) },
    }),
    configureServer(server) {
      server.middlewares.use(base, (req, res, next) => {
        const file = req.url?.split('?')[0].slice(1) ?? ''
        if (!files.includes(file)) return next()
        // Raw gzip bytes; the client inflates them itself.
        res.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(join(dictDir, file)).pipe(res)
      })
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${base.slice(1)}${file}`,
          source: readFileSync(join(dictDir, file)),
        })
      }
    },
  }
}
