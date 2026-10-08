// Controlled cold-load and navigation profile behind docs/PERFORMANCE.md.
// Each round uses a fresh installed-Chrome context (1280×800, reduced motion,
// no throttling) against bench/browser/server.ts, signs in the fixture from
// bench/browser/fixture.ts, and samples resources up to useful content: the
// first rendered target text plus one animation frame, then a 350 ms settle.
//
//   PERF_EMAIL=… PERF_PASSWORD=… node bench/browser/profile.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'

type PerfState = {
  ready: number | null
  longTasks: { start: number; ms: number }[]
  lcp: number | null
  cls: number
}
declare global {
  interface Window {
    __perf: PerfState
  }
}

const BASE = 'http://localhost:5190'
const email = process.env.PERF_EMAIL
const password = process.env.PERF_PASSWORD
if (!email || !password) throw new Error('Set PERF_EMAIL and PERF_PASSWORD.')
const builds = (process.env.PERF_BUILDS ?? 'before,after').split(',')
const rounds = Number(process.env.PERF_ROUNDS ?? 3)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = process.env.PERF_OUT ?? `bench/results/browser-${stamp}.json`

function instrument(page: Page) {
  return page.addInitScript(() => {
    window.__perf = { ready: null, longTasks: [], lcp: null, cls: 0 }
    const observe = (type: string, fn: (entry: PerformanceEntry) => void) => {
      try {
        new PerformanceObserver((list) =>
          list.getEntries().forEach(fn),
        ).observe({ type, buffered: true })
      } catch {
        // Entry type unsupported in this browser.
      }
    }
    observe('longtask', (e) =>
      window.__perf.longTasks.push({ start: e.startTime, ms: e.duration }),
    )
    observe('largest-contentful-paint', (e) => {
      window.__perf.lcp = e.startTime
    })
    observe('layout-shift', (e) => {
      const shift = e as PerformanceEntry & {
        hadRecentInput: boolean
        value: number
      }
      if (!shift.hadRecentInput) window.__perf.cls += shift.value
    })
    // Useful content: a real translation, not the loading shell.
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.segment__tgt-text')) return
      requestAnimationFrame(() => {
        window.__perf.ready ??= performance.now()
      })
      observer.disconnect()
    }).observe(document, { subtree: true, childList: true })
  })
}

function snapshot(page: Page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[]
    const timing = (e: PerformanceResourceTiming) => ({
      path: new URL(e.name).pathname,
      start: e.startTime,
      end: e.responseEnd,
      bytes: e.transferSize,
      decoded: e.decodedBodySize,
    })
    return {
      ...window.__perf,
      paints: performance
        .getEntriesByType('paint')
        .map((e) => ({ name: e.name, ms: e.startTime })),
      cards: document.querySelectorAll('.segment').length,
      dom: document.querySelectorAll('*').length,
      count: resources.length,
      bytes: resources.reduce((sum, e) => sum + e.transferSize, 0),
      decoded: resources.reduce((sum, e) => sum + e.decodedBodySize, 0),
      api: resources
        .filter((e) => new URL(e.name).pathname.startsWith('/api/'))
        .map((e) => ({ ...timing(e), ms: e.duration })),
      waterfall: resources.map(timing),
    }
  })
}

async function action(
  page: Page,
  name: string,
  run: () => Promise<unknown>,
  ready: () => Promise<unknown>,
) {
  await page.evaluate(() => performance.clearResourceTimings())
  const start = await page.evaluate(() => performance.now())
  await run()
  await ready()
  const data = await snapshot(page)
  const end = await page.evaluate(() => performance.now())
  return { name, ms: end - start, api: data.api, cards: data.cards }
}

const titleReady = (page: Page, title: string) =>
  page.waitForFunction(
    (t) =>
      document.querySelector('.workspace__title')?.textContent?.includes(t) &&
      !!document.querySelector('.segment__tgt-text'),
    title,
  )

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
try {
  for (const build of builds)
    for (let round = 0; round < rounds; round++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      })
      await context.addCookies([
        { name: 'perf-build', value: build, url: BASE },
      ])
      const auth = await context.request.post(
        `${BASE}/api/auth/sign-in/email`,
        { headers: { origin: BASE }, data: { email, password } },
      )
      if (auth.status() !== 200)
        throw new Error(`Fixture sign-in failed: ${auth.status()}`)
      const page = await context.newPage()
      await instrument(page)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${BASE}/app`)
      await page.waitForFunction(() => window.__perf.ready !== null)
      await page.waitForTimeout(350)
      const cold = await snapshot(page)
      const interactions = [
        await action(
          page,
          'short thread',
          () => page.getByRole('button', { name: /Short thread 1-1/ }).click(),
          () =>
            page.waitForFunction(
              () => document.querySelectorAll('.segment').length === 10,
            ),
        ),
        await action(
          page,
          'return long thread',
          () => page.getByRole('button', { name: /Long thread 1/ }).click(),
          () =>
            page.waitForFunction(
              () => document.querySelectorAll('.segment').length > 10,
            ),
        ),
        await action(
          page,
          'character 2',
          () => page.getByRole('button', { name: /Perf Character 2/ }).click(),
          () => titleReady(page, 'Long thread 2'),
        ),
        await action(
          page,
          'return character 1',
          () => page.getByRole('button', { name: /Perf Character 1/ }).click(),
          () => titleReady(page, 'Long thread 1'),
        ),
        await action(
          page,
          'pricing',
          () =>
            page
              .getByRole('link', { name: 'Pricing', exact: true })
              .first()
              .click(),
          () =>
            page
              .getByRole('heading', { name: 'Pay for what you ship.' })
              .waitFor(),
        ),
        await action(
          page,
          'billing tabs',
          async () => {
            await page
              .getByRole('button', { name: 'Monthly', exact: true })
              .click()
            await page.getByRole('button', { name: /Annual/ }).click()
          },
          () => Promise.resolve(),
        ),
        await action(
          page,
          'return app',
          () =>
            page
              .getByRole('link', { name: 'App', exact: true })
              .first()
              .click(),
          () =>
            page.waitForFunction(
              () => !!document.querySelector('.segment__tgt-text'),
            ),
        ),
      ]
      results.push({ build, round, cold, interactions, errors })
      console.log(
        JSON.stringify({
          build,
          round,
          ready: Math.round(cold.ready ?? NaN),
          api: cold.api.length,
          cards: cold.cards,
          interactions: interactions.map((x) => [x.name, Math.round(x.ms)]),
          errors,
        }),
      )
      await context.close()
    }
} finally {
  await browser.close()
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
for (const build of builds) {
  const runs = results.filter((r) => r.build === build)
  console.log(
    `${build}: useful content median ${Math.round(median(runs.map((r) => r.cold.ready ?? NaN)))} ms`,
  )
}
mkdirSync('bench/results', { recursive: true })
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(`Raw runs: ${out}`)
