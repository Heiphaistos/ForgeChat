/*
 * ForgeChat — marque 3D vivante (Three.js), même esprit que les logos animés
 * des vitrines du portefeuille (FileScanner, SecuScan, etc.) : un seul mark
 * iconique extrudé, rotation d'idle continue, jamais de guard
 * prefers-reduced-motion (choix de style du portefeuille — le mouvement reste
 * toujours actif). Reprend le thème de l'icône statique (icon.svg) : une
 * enclume de forge, avec des étincelles de marteau qui jaillissent par cycles.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface Props {
  size?: number
  className?: string
}

const ACCENT = 0x5865f2
const ACCENT_LIGHT = 0x818cf8
const SPARK = 0xfcd34d

/** Silhouette 2D profil enclume (vue de côté) -- une seule forme extrudée, comme le
 * monogramme "F" des autres vitrines : lisible depuis n'importe quel angle proche du
 * face-à-face, contrairement à un assemblage de primitives qui ne cohère qu'à un
 * angle précis. */
function buildAnvilShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0.3, 0)
  s.lineTo(0.7, 0)      // pied (bas)
  s.lineTo(0.7, 0.15)
  s.lineTo(0.85, 0.15)  // corps (droite)
  s.lineTo(0.85, 0.55)
  s.lineTo(1.05, 0.55)  // table déborde à droite
  s.lineTo(1.05, 0.72)
  s.lineTo(-0.05, 0.72) // dessus plat de la table
  s.lineTo(-0.05, 0.55) // table déborde à gauche
  s.lineTo(0.15, 0.55)
  s.lineTo(0.15, 0.48)
  s.lineTo(-0.45, 0.40) // pointe de la corne
  s.lineTo(0.15, 0.32)
  s.lineTo(0.15, 0.15)  // corps (gauche)
  s.lineTo(0.3, 0.15)   // pied (gauche)
  s.closePath()
  return s
}

function buildAnvil(): THREE.Group {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: ACCENT, metalness: 0.42, roughness: 0.32 })

  const geo = new THREE.ExtrudeGeometry(buildAnvilShape(), {
    depth: 0.4,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 8,
  })
  geo.computeBoundingBox()
  const center = new THREE.Vector3()
  geo.boundingBox!.getCenter(center)
  geo.translate(-center.x, -center.y, -center.z)
  group.add(new THREE.Mesh(geo, mat))

  // Fine plaque claire sur le dessus de la table -- rappel du ton clair de l'icône statique
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1.06, 0.05, 0.46),
    new THREE.MeshStandardMaterial({ color: ACCENT_LIGHT, metalness: 0.4, roughness: 0.28 }),
  )
  plate.position.set(0.5 - center.x, 0.72 - center.y + 0.025, 0)
  group.add(plate)

  return group
}

/** Étincelle : petit sprite additif qui jaillit puis retombe/s'éteint, en boucle décalée. */
function buildSparks(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: SPARK,
    size: 0.09,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  return new THREE.Points(geo, mat)
}

export default function Logo3D({ size = 40, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size, size, false)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10)
    camera.position.set(0, 0.15, 3.6)

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(2, 3, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(ACCENT, 0.65)
    rim.position.set(-3, -1, -2)
    scene.add(rim)

    const group = buildAnvil()
    group.rotation.x = -0.18
    group.rotation.y = 0.5
    scene.add(group)

    const SPARK_COUNT = 5
    const sparks = buildSparks(SPARK_COUNT)
    // Origine des étincelles : coin haut-droit de la table (là où "frappe le marteau")
    sparks.position.set(0.55, 0.55, 0.15)
    scene.add(sparks)

    const clock = new THREE.Clock()
    let frameId = 0
    let running = true
    const handleVisibility = () => { running = document.visibilityState === 'visible' }
    document.addEventListener('visibilitychange', handleVisibility)

    // Cycle de frappe : toutes les ~1.8s, les étincelles jaillissent puis retombent
    const STRIKE_PERIOD = 1.8
    const posAttr = sparks.geometry.getAttribute('position') as THREE.BufferAttribute

    const tick = () => {
      frameId = requestAnimationFrame(tick)
      if (!running) return

      const t = clock.getElapsedTime()
      // Oscillation bornée (pas un tour complet) : l'enclume garde toujours son profil
      // 3/4 reconnaissable (corne + table + corps visibles) -- une rotation Y continue
      // traverse des angles où la silhouette s'aplatit en simple bloc méconnaissable.
      group.rotation.y = 0.55 + Math.sin(t * 0.45) * 0.42
      group.rotation.x = -0.16 + Math.sin(t * 0.7) * 0.05

      const cyclePos = (t % STRIKE_PERIOD) / STRIKE_PERIOD
      const active = cyclePos < 0.35
      const mat = sparks.material as THREE.PointsMaterial
      if (active) {
        const local = cyclePos / 0.35
        mat.opacity = Math.sin(local * Math.PI) * 0.9
        for (let i = 0; i < SPARK_COUNT; i++) {
          const seed = i * 1.7
          const spread = local * 0.55
          posAttr.setXYZ(
            i,
            Math.cos(seed) * spread,
            local * 0.5 - local * local * 0.35 + Math.sin(seed) * 0.06,
            Math.sin(seed) * spread * 0.5,
          )
        }
        posAttr.needsUpdate = true
      } else {
        mat.opacity = 0
      }

      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', handleVisibility)
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
          else obj.material.dispose()
        }
      })
      sparks.geometry.dispose()
      ;(sparks.material as THREE.PointsMaterial).dispose()
      renderer.dispose()
    }
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block', flexShrink: 0 }}
    />
  )
}
