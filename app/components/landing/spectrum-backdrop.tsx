import { useEffect, useRef } from 'react'

// Original procedural light field, using the existing Vibe brand spectrum.
// CSS supplies the complete static poster; WebGL only adds refraction and drift.
const fragmentShader = `
  uniform float uTime;
  uniform float uAspect;
  uniform float uClosing;
  uniform float uHover;
  uniform vec2 uPointer;
  varying vec2 vUv;
  const float PI = 3.14159265359;
  vec3 spectrum(float t) {
    return 0.52 + 0.48 * cos(6.28318 * (t + vec3(0.02, 0.35, 0.67)));
  }
  // Premultiplied light lets RGB samples separate without muddy dark fringes.
  vec4 lightField(vec2 uv) {
    if (uClosing > 0.5) {
      vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
      float radius = length(p);
      float angle = atan(p.y, p.x);
      float scale = min(1.0, uAspect / 1.15);
      vec3 light = vec3(0.0);
      float alpha = 0.0;
      for (int i = 0; i < 4; i++) {
        float layer = float(i);
        float orbit = (0.29 + layer * 0.17) * scale;
        orbit += sin(uTime * 0.16 + layer * 1.8) * 0.006;
        float distanceToRing = radius - orbit;
        float glow = exp(-pow(distanceToRing / (0.055 * scale), 2.0));
        float rim = exp(-pow(distanceToRing / (0.014 * scale), 2.0));
        float strength = (glow * 0.19 + rim * 0.045) * (1.0 - layer * 0.10);
        // Each halo has its own spectral phase and slow rotation, sharing a center.
        vec3 color = spectrum(angle / (2.0 * PI) + layer * 0.14
          + uTime * (0.012 - layer * 0.002));
        light += color * strength;
        alpha += strength;
      }
      float fade = smoothstep(0.0, 0.14, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y));
      return vec4(light * fade, alpha * fade);
    }
    vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.76);
    p -= (uPointer - 0.5) * 0.035 * uHover;
    float angle = atan(p.y, p.x);
    float wave = sin(angle * 3.0 + uTime * 0.23) * 0.028
      + sin(angle * 7.0 - uTime * 0.17) * 0.012;
    float radius = length(p * vec2(0.82, 1.0));
    float ring = exp(-pow((radius - 0.49 - wave) / 0.15, 2.0));
    float filament = exp(-pow((radius - 0.49 - wave) / 0.018, 2.0));
    float fade = smoothstep(0.0, 0.18, uv.y) * (1.0 - smoothstep(0.92, 1.0, uv.y));
    float shimmer = 0.86 + 0.14 * sin(angle * 4.0 + uTime * 0.35);
    vec3 color = spectrum(angle / (2.0 * PI) + uTime * 0.018 + radius * 0.22);
    float alpha = (ring * 0.27 * shimmer + filament * 0.10) * fade;
    return vec4(color * alpha, alpha);
  }
  void main() {
    if (uClosing > 0.5) {
      vec4 field = lightField(vUv);
      gl_FragColor = vec4(field.rgb / max(field.a, 0.0001), field.a);
      return;
    }
    vec2 delta = (vUv - uPointer) * vec2(uAspect, 1.0);
    float lens = exp(-dot(delta, delta) * 7.0) * uHover * (1.0 - uClosing);
    // A local optical lens splits color channels; no wavefronts or water simulation.
    vec2 offset = (delta * 0.08 + vec2(0.035, 0.008)) * lens / vec2(uAspect, 1.0);
    vec4 red = lightField(vUv + offset);
    vec4 green = lightField(vUv);
    vec4 blue = lightField(vUv - offset);
    float alpha = max(red.a, max(green.a, blue.a));
    vec3 color = vec3(red.r, green.g, blue.b) / max(alpha, 0.0001);
    gl_FragColor = vec4(color, alpha);
  }
`

export function SpectrumBackdrop({
  closing = false,
  paused,
}: {
  closing?: boolean
  paused: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    const section = host.parentElement!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    let visible = false
    let starting = false
    let generation = 0
    let pageFocused = document.hasFocus()
    const updateTextMotion = () => {
      section.dataset.inView = String(
        visible && !document.hidden && pageFocused,
      )
    }
    const pageBlur = () => {
      pageFocused = false
      updateTextMotion()
    }
    const pageFocus = () => {
      pageFocused = true
      updateTextMotion()
    }
    window.addEventListener('blur', pageBlur)
    window.addEventListener('focus', pageFocus)
    document.addEventListener('visibilitychange', updateTextMotion)
    let release: (() => void) | undefined
    let syncRendering: (() => void) | undefined

    const start = async () => {
      if (starting || disposed || paused || reduced.matches || !visible) return
      starting = true
      const attempt = generation
      try {
        // Keep the renderer off the initial route bundle, and defer the CTA canvas.
        const THREE = await import('three')
        if (disposed || reduced.matches || attempt !== generation) return
        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: false,
          powerPreference: 'low-power',
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
        const scene = new THREE.Scene()
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const geometry = new THREE.PlaneGeometry(2, 2)
        const uniforms = {
          uTime: { value: closing ? 24 : 0 },
          uAspect: { value: 1 },
          uClosing: { value: closing ? 1 : 0 },
          uPointer: { value: new THREE.Vector2(0.5, 0.5) },
          uHover: { value: 0 },
        }
        const material = new THREE.ShaderMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
          uniforms,
          vertexShader:
            'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader,
        })
        scene.add(new THREE.Mesh(geometry, material))
        const canvas = renderer.domElement
        canvas.setAttribute('aria-hidden', 'true')
        host.appendChild(canvas)
        let frame = 0
        let last = 0
        let elapsed = 0
        let lost = false
        let focused = document.hasFocus()
        const pointer = new THREE.Vector2(0.5, 0.5)
        let hovering = 0
        const finePointer = window.matchMedia(
          '(hover: hover) and (pointer: fine)',
        )
        let rect = section.getBoundingClientRect()

        const stop = () => {
          cancelAnimationFrame(frame)
          frame = 0
          last = 0
        }
        const render = (now: number) => {
          frame = requestAnimationFrame(render)
          // Bound work to 30fps, including on high-refresh screens.
          if (last && now - last < 32) return
          if (last) elapsed += Math.min(now - last, 80) / 1000
          last = now
          uniforms.uTime.value = elapsed + (closing ? 24 : 0)
          uniforms.uPointer.value.lerp(pointer, 0.12)
          uniforms.uHover.value += (hovering - uniforms.uHover.value) * 0.1
          renderer.render(scene, camera)
        }
        const sync = () => {
          stop()
          if (
            visible &&
            !document.hidden &&
            focused &&
            !lost &&
            !reduced.matches
          ) {
            frame = requestAnimationFrame(render)
          }
        }
        syncRendering = sync
        const resize = () => {
          rect = section.getBoundingClientRect()
          renderer.setSize(host.clientWidth, host.clientHeight, false)
          uniforms.uAspect.value =
            host.clientWidth / Math.max(host.clientHeight, 1)
          if (!lost) {
            renderer.render(scene, camera)
            host.dataset.live = 'true'
          }
        }
        const move = (event: PointerEvent) => {
          if (!finePointer.matches || event.pointerType !== 'mouse' || closing)
            return
          hovering = 1
          pointer.set(
            (event.clientX - rect.left) / rect.width,
            1 - (event.clientY - rect.top) / rect.height,
          )
        }
        const reset = () => {
          hovering = 0
          pointer.set(0.5, 0.5)
        }
        const enter = () => {
          rect = section.getBoundingClientRect()
        }
        const blur = () => {
          focused = false
          reset()
          sync()
        }
        const focus = () => {
          focused = true
          sync()
        }
        const contextLost = () => {
          lost = true
          delete host.dataset.live
          canvas.hidden = true
          sync()
        }
        const contextRestored = () => {
          lost = false
          canvas.hidden = false
          resize()
          sync()
        }
        const resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)
        section.addEventListener('pointermove', move, { passive: true })
        section.addEventListener('pointerenter', enter)
        section.addEventListener('pointerleave', reset)
        window.addEventListener('blur', blur)
        window.addEventListener('focus', focus)
        document.addEventListener('visibilitychange', sync)
        canvas.addEventListener('webglcontextlost', contextLost)
        canvas.addEventListener('webglcontextrestored', contextRestored)
        release = () => {
          stop()
          resizeObserver.disconnect()
          section.removeEventListener('pointermove', move)
          section.removeEventListener('pointerenter', enter)
          section.removeEventListener('pointerleave', reset)
          window.removeEventListener('blur', blur)
          window.removeEventListener('focus', focus)
          document.removeEventListener('visibilitychange', sync)
          canvas.removeEventListener('webglcontextlost', contextLost)
          canvas.removeEventListener('webglcontextrestored', contextRestored)
          geometry.dispose()
          material.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
          canvas.remove()
          delete host.dataset.live
          syncRendering = undefined
        }
        resize()
        sync()
      } catch {
        // Unsupported WebGL/import failure leaves the static spectrum intact.
        release?.()
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      updateTextMotion()
      void start()
      syncRendering?.()
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
    return () => {
      disposed = true
      generation++
      window.removeEventListener('blur', pageBlur)
      window.removeEventListener('focus', pageFocus)
      document.removeEventListener('visibilitychange', updateTextMotion)
      observer.disconnect()
      reduced.removeEventListener('change', preferenceChanged)
      release?.()
      delete section.dataset.inView
    }
  }, [closing, paused])

  return (
    <div
      ref={ref}
      className={`spectrum-backdrop${closing ? ' spectrum-backdrop--closing' : ''}`}
      aria-hidden="true"
    />
  )
}
