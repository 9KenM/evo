import {
  ACESFilmicToneMapping,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Texture,
} from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type { StarState } from '../domain/index.js'
import { SCHWARZSCHILD_KM_PER_SOLAR_MASS, SOLAR_LOG_G, SOLAR_RADIUS_KM } from '../domain/index.js'
import { FULLSCREEN_VERTEX } from './shaders/common.js'
import { SPHERE_FRAGMENT } from './shaders/sphere.js'
import { BLACK_HOLE_FRAGMENT } from './shaders/blackHole.js'
import type { Camera } from './camera.js'
import { BACKDROP_LEVEL, opticsFor, type CameraOptics } from './exposure.js'

/**
 * Bloom threshold, in the display-referred units the shader now emits.
 *
 * Sits above the nebula but below the brightest field stars, so the diffuse sky contributes
 * atmosphere without hazing the frame, while point sources and luminous subjects still glow.
 */
const BLOOM_THRESHOLD = 0.9

/** Noise cells across the disk at solar surface gravity. */
const GRANULE_BASE = 18
/** How strongly granule size tracks log g. Convective cell size scales with pressure scale height. */
const GRANULE_GRAVITY_EXPONENT = 0.35

export class Stage {
  private readonly renderer: WebGLRenderer
  private readonly composer: EffectComposer
  private readonly scene = new Scene()
  private readonly view = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh: Mesh
  private readonly sphere: ShaderMaterial
  private readonly blackHole: ShaderMaterial
  private readonly bloom: UnrealBloomPass
  private readonly onContextLost: (e: Event) => void
  private readonly onContextRestored: () => void
  private elapsed = 0
  private lost = false
  private lastOptics: CameraOptics | null = null

  /** Camera characteristics of the most recent frame, for display in the UI. */
  get optics(): CameraOptics | null {
    return this.lastOptics
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.outputColorSpace = SRGBColorSpace

    const shared = {
      uResolution: { value: new Vector2(1, 1) },
      uSpan: { value: 3 },
      uStarfield: { value: loadTexture('/img/starfield.png') },
      // Two tileable cloud plates, summed as octaves in skyColor.
      uNebula: { value: loadTexture('/img/cloudsB2.jpg') },
      uNebula2: { value: loadTexture('/img/cloudsR2.jpg') },
      uBackdropGain: { value: BACKDROP_LEVEL },
      uOrbit: { value: new Vector2(0, 0) },
    }

    this.sphere = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: SPHERE_FRAGMENT,
      uniforms: {
        ...shared,
        uRadius: { value: 1 },
        uColor: { value: [1, 1, 1] },
        uRadiance: { value: 1 },
        uGranulation: { value: 0.28 },
        uGranuleScale: { value: GRANULE_BASE },
        uLimbDarkening: { value: 0.6 },
        uTime: { value: 0 },
        uExposure: { value: 1 },
      },
    })

    this.blackHole = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLACK_HOLE_FRAGMENT,
      uniforms: { ...shared, uSchwarzschild: { value: 1e-5 } },
    })

    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.sphere)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0 })
    this.composer = new EffectComposer(this.renderer, target)
    this.composer.addPass(new RenderPass(this.scene, this.view))

    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.45, 0.6, BLOOM_THRESHOLD)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.onContextLost = (event) => {
      event.preventDefault()
      this.lost = true
    }
    this.onContextRestored = () => {
      this.lost = false
      this.resize()
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)

    this.resize()
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))

    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloom.setSize(width, height)

    const resolution = new Vector2(width, height)
    this.sphere.uniforms.uResolution!.value = resolution
    this.blackHole.uniforms.uResolution!.value = resolution
  }

  render(star: StarState, camera: Camera, dt: number): void {
    if (this.lost) return
    this.elapsed += dt

    // Both materials were built from one `shared` object, so these uniform holders are the same
    // instances — writing through either updates both.
    const { azimuth, elevation } = camera.orbit
    this.sphere.uniforms.uSpan!.value = camera.span
    ;(this.sphere.uniforms.uOrbit!.value as Vector2).set(azimuth, elevation)

    // The star is rendered at its true radiance; the camera is what adapts. Exposure is handed to
    // the shader rather than the tonemap so that bloom, which runs earlier in the chain, sees
    // display-referred values.
    const optics = opticsFor(star, camera.span)
    this.lastOptics = optics
    this.sphere.uniforms.uExposure!.value = optics.exposure

    if (star.stage === 'black hole') {
      this.mesh.material = this.blackHole
      this.blackHole.uniforms.uSchwarzschild!.value =
        (SCHWARZSCHILD_KM_PER_SOLAR_MASS * star.mass) / SOLAR_RADIUS_KM
    } else {
      this.mesh.material = this.sphere
      this.applySphereUniforms(star, optics)
    }

    this.composer.render(dt)
  }

  private applySphereUniforms(star: StarState, optics: CameraOptics): void {
    const u = this.sphere.uniforms

    u.uRadius!.value = star.radius
    u.uColor!.value = [star.colorLinear.r, star.colorLinear.g, star.colorLinear.b]
    u.uRadiance!.value = optics.radiance
    u.uTime!.value = this.elapsed

    // Convective envelopes exist in cool stars; hot photospheres are radiative and smooth.
    const convective = smoothstep(9000, 6000, star.temperature)
    const compact = star.stage === 'white dwarf' || star.stage === 'neutron star'

    // Contrast rises as gravity falls: giant convection is far more violent than the Sun's, with a
    // few enormous cells rather than millions of small ones.
    const lowGravity = Math.min(1, Math.max(0, (SOLAR_LOG_G - star.surfaceGravity) / 3.5))
    u.uGranulation!.value = compact ? 0 : (0.22 + 0.35 * lowGravity) * convective

    u.uGranuleScale!.value =
      GRANULE_BASE * Math.pow(10, (star.surfaceGravity - SOLAR_LOG_G) * GRANULE_GRAVITY_EXPONENT)

    // Cool giants are more strongly limb-darkened than hot dwarfs.
    u.uLimbDarkening!.value = 0.35 + 0.45 * convective
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.composer.dispose()
    this.renderer.dispose()
  }
}

function loadTexture(url: string): Texture {
  const texture = new TextureLoader().load(url)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
