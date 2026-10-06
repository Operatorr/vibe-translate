import { useEffect, useRef } from 'react'

// Original Vibe palette and conic wash; no rings or ripple simulation.
const fragmentShader = `
  uniform float uTime;
  uniform float uAspect;
  uniform float uHover;
  uniform vec2 uPointer;
  varying vec2 vUv;
  const float TAU = 6.28318530718;
  vec3 palette(float t) {
    float step = fract(t) * 10.0;
    float f = smoothstep(0.0, 1.0, fract(step));
    vec3 blue = vec3(0.122, 0.478, 1.0);
    vec3 cyan = vec3(0.0, 0.659, 1.0);
    vec3 teal = vec3(0.063, 0.773, 0.580);
    vec3 green = vec3(0.247, 0.725, 0.114);
    vec3 yellow = vec3(0.961, 0.722, 0.0);
    vec3 amber = vec3(1.0, 0.541, 0.0);
    vec3 orange = vec3(1.0, 0.341, 0.133);
    vec3 red = vec3(1.0, 0.180, 0.180);
    vec3 pink = vec3(1.0, 0.122, 0.616);
    vec3 violet = vec3(0.188, 0.341, 1.0);
    if (step < 1.0) return mix(blue, cyan, f);
    if (step < 2.0) return mix(cyan, teal, f);
    if (step < 3.0) return mix(teal, green, f);
    if (step < 4.0) return mix(green, yellow, f);
    if (step < 5.0) return mix(yellow, amber, f);
    if (step < 6.0) return mix(amber, orange, f);
    if (step < 7.0) return mix(orange, red, f);
    if (step < 8.0) return mix(red, pink, f);
    if (step < 9.0) return mix(pink, violet, f);
    return mix(violet, blue, f);
  }
  vec3 wash(vec2 uv) {
    vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
    // A generous pull across the whole wash, compared with the hero's 0.035.
    p -= (uPointer - 0.5) * vec2(uAspect, 1.0) * 0.32 * uHover;
    float angle = atan(p.x, p.y) / TAU - 0.5 - uTime / 24.0;
    // Soften the junction like the original blurred CSS gradient.
    float saturation = smoothstep(0.0, 0.65, length(p));
    return mix(vec3(0.30, 0.27, 0.31), palette(angle), saturation);
  }
  void main() {
    vec2 delta = (vUv - uPointer) * vec2(uAspect, 1.0);
    // Broader reach and ~3x the hero's RGB offset, without moving text or buttons.
    float lens = exp(-dot(delta, delta) * 2.0) * uHover;
    vec2 offset = (delta * 0.18 + vec2(0.105, 0.025)) * lens / vec2(uAspect, 1.0);
    vec3 color = vec3(wash(vUv + offset).r, wash(vUv).g, wash(vUv - offset).b);
    gl_FragColor = vec4(color, 0.35);
  }
`

export function CtaBackdrop({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const section = host.parentElement!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    let visible = false
    let focused = document.hasFocus()
    let disposed = false
    let starting = false
    let generation = 0
    let release: (() => void) | undefined
    let syncRenderer: (() => void) | undefined

    const sync = () => {
      host.dataset.active = String(visible && focused && !document.hidden)
      syncRenderer?.()
    }
    const blur = () => {
      focused = false
      sync()
    }
    const focus = () => {
      focused = true
      sync()
    }
    const sizePoster = () => {
      // A square larger than the diagonal never exposes corners while spinning.
      host.style.setProperty(
        '--cta-field-size',
        `${Math.hypot(host.clientWidth, host.clientHeight) * 1.1}px`,
      )
    }
    const posterResize = new ResizeObserver(sizePoster)
    posterResize.observe(host)
    sizePoster()

    const start = async () => {
      if (disposed || starting || paused || reduced.matches || !visible) return
      starting = true
      const attempt = generation
      try {
        const THREE = await import('three')
        if (disposed || attempt !== generation || reduced.matches) return
        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: false,
          powerPreference: 'low-power',
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
        const canvas = renderer.domElement
        canvas.className = 'cta-wash__canvas'
        canvas.setAttribute('aria-hidden', 'true')
        const geometry = new THREE.PlaneGeometry(2, 2)
        const uniforms = {
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uHover: { value: 0 },
          uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        }
        const material = new THREE.ShaderMaterial({
          uniforms,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          vertexShader:
            'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader,
        })
        const scene = new THREE.Scene()
        scene.add(new THREE.Mesh(geometry, material))
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const pointer = new THREE.Vector2(0.5, 0.5)
        let hovering = 0
        let lost = false
        let frame = 0
        let last = 0
        let elapsed = 0
        let lastMove = -Infinity
        const stop = () => {
          cancelAnimationFrame(frame)
          frame = 0
          last = 0
        }
        const reset = () => {
          hovering = 0
          pointer.set(0.5, 0.5)
        }
        const render = (now: number) => {
          frame = requestAnimationFrame(render)
          if (last && now - last < 32) return
          if (last) elapsed += Math.min(now - last, 80) / 1000
          last = now
          uniforms.uTime.value = elapsed
          uniforms.uPointer.value.lerp(pointer, 0.14)
          uniforms.uHover.value += (hovering - uniforms.uHover.value) * 0.12
          renderer.render(scene, camera)
        }
        syncRenderer = () => {
          stop()
          if (!focused || document.hidden || !visible) reset()
          if (
            visible &&
            focused &&
            !document.hidden &&
            !lost &&
            !reduced.matches
          )
            frame = requestAnimationFrame(render)
        }
        const resize = () => {
          renderer.setSize(section.clientWidth, section.clientHeight, false)
          uniforms.uAspect.value =
            section.clientWidth / Math.max(section.clientHeight, 1)
          if (!lost) {
            renderer.render(scene, camera)
            host.dataset.live = 'true'
          }
        }
        const move = (event: PointerEvent) => {
          if (!fine.matches || event.pointerType !== 'mouse') return
          const now = performance.now()
          if (now - lastMove < 32) return
          lastMove = now
          const bounds = section.getBoundingClientRect()
          hovering = 1
          pointer.set(
            (event.clientX - bounds.left) / bounds.width,
            1 - (event.clientY - bounds.top) / bounds.height,
          )
        }
        const lostContext = () => {
          lost = true
          canvas.hidden = true
          delete host.dataset.live
          syncRenderer?.()
        }
        const restoredContext = () => {
          lost = false
          canvas.hidden = false
          resize()
          syncRenderer?.()
        }
        const resizeObserver = new ResizeObserver(resize)
        release = () => {
          stop()
          resizeObserver.disconnect()
          section.removeEventListener('pointermove', move)
          section.removeEventListener('pointerleave', reset)
          canvas.removeEventListener('webglcontextlost', lostContext)
          canvas.removeEventListener('webglcontextrestored', restoredContext)
          geometry.dispose()
          material.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
          canvas.remove()
          delete host.dataset.live
          syncRenderer = undefined
        }
        host.appendChild(canvas)
        resizeObserver.observe(section)
        section.addEventListener('pointermove', move, { passive: true })
        section.addEventListener('pointerleave', reset)
        canvas.addEventListener('webglcontextlost', lostContext)
        canvas.addEventListener('webglcontextrestored', restoredContext)
        resize()
        sync()
      } catch {
        release?.() /* The original spinning CSS wash remains usable. */
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
      void start()
    })
    observer.observe(section)
    const preferenceChanged = () => {
      generation++
      release?.()
      release = undefined
      starting = false
      void start()
    }
    reduced.addEventListener('change', preferenceChanged)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    return () => {
      disposed = true
      generation++
      release?.()
      observer.disconnect()
      posterResize.disconnect()
      reduced.removeEventListener('change', preferenceChanged)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', focus)
    }
  }, [paused])
  return (
    <div ref={ref} className="cta-strip__halo cta-wash" aria-hidden="true" />
  )
}
