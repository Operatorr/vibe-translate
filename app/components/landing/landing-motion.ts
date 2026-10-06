import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

gsap.registerPlugin(ScrollTrigger)

// Lenis is lighter than Locomotive for this unpinned, normal-flow page.
// Native touch and keyboard scrolling stay intact; no other scroll engine.
export function createLandingMotion(root: HTMLElement) {
  let disposed = false
  const media = gsap.matchMedia()
  media.add(
    '(prefers-reduced-motion: no-preference)',
    () => {
      const intro = gsap.timeline({
        defaults: { ease: 'power3.out', duration: 1 },
      })
      intro
        .from('.hero__eyebrow', { y: 12, opacity: 0.5 })
        .from('.hero__line', { y: 28, opacity: 0.55, stagger: 0.12 }, 0.12)
        .from('.hero__sub', { y: 16, opacity: 0.6 }, 0.3)
        .from('.hero .hero__ctas', { y: 12, opacity: 0.7 }, 0.42)
        .from('.hero__bench-item', { y: 10, opacity: 0.5, stagger: 0.06 }, 0.55)

      root
        .querySelectorAll<HTMLElement>('.section, .cta-strip, .demo')
        .forEach((section) => {
          const words = section.querySelectorAll('.reveal-word')
          const supporting = section.querySelectorAll(
            '.section__sub, .step, .vibe-show__left, .vibe-show__pair, .feature, .faq, .demo__frame, .cta-strip__sub, .hero__ctas',
          )
          const timeline = gsap.timeline({
            scrollTrigger: { trigger: section, start: 'top 88%', once: true },
            defaults: { duration: 0.85, ease: 'power3.out' },
          })
          if (words.length)
            timeline.from(words, { y: 18, opacity: 0.45, stagger: 0.025 })
          if (supporting.length)
            timeline.from(
              supporting,
              { y: 20, opacity: 0.6, stagger: 0.08 },
              words.length ? 0.18 : 0,
            )
        })
      return () => {}
    },
    root,
  )

  // Keep touch native, even on hybrid devices.
  media.add(
    '(prefers-reduced-motion: no-preference) and (pointer: fine)',
    () => {
      const lenis = new Lenis({
        duration: 0.85,
        smoothWheel: true,
        syncTouch: false,
        anchors: true,
        prevent: (node) =>
          node.tagName === 'TEXTAREA' ||
          !!node.closest('[role="dialog"], [data-lenis-prevent]'),
      })
      lenis.on('scroll', ScrollTrigger.update)
      const tick = () => lenis.raf(performance.now())
      gsap.ticker.add(tick)
      // Real time on the shared ticker avoids lag smoothing changing Lenis time.
      return () => {
        gsap.ticker.remove(tick)
        lenis.destroy()
      }
    },
  )
  const refresh = () => {
    if (!disposed) ScrollTrigger.refresh()
  }
  void document.fonts.ready.then(refresh)
  root.addEventListener('load', refresh, true)
  return () => {
    disposed = true
    root.removeEventListener('load', refresh, true)
    media.revert()
  }
}
