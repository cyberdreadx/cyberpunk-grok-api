import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * GridCity — a living digital city rendered with react-three-fiber.
 *
 * Mission-control palette: a near-black metropolis with strategic red
 * highlights. Most towers idle in dim monochrome; red towers are the
 * autonomous swarm acting on live anomalies. The camera is choreographed
 * to scroll — wide overwatch orbit, a dive toward the core, a street-level
 * pass, then a rise to full grid overview. Pure three.js + R3F, no
 * post-processing (the glow comes from emissive faces + additive sprites
 * over a fogged black scene).
 */

const BG = 0x040405;
const WHITE_DIM = 0x9aa0ad;
const EMBER = 0xff5a3c;
const RED = 0xff2433;
const RED_DEEP = 0x8c1018;

type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  edge: number;
  alert: boolean;
  beam: boolean;
  seed: number;
};

/** Build a skyline on a street grid, denser toward the center. */
function buildCity(density: number): Building[] {
  const out: Building[] = [];
  const cells = density; // cells per axis
  const span = 110;
  const step = span / cells;
  const half = span / 2;
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx = -half + gx * step + step / 2;
      const cz = -half + gz * step + step / 2;
      const dist = Math.hypot(cx, cz) / half; // 0 center .. ~1.4 edge
      // Leave the very center open for the core spire, skip cells for streets.
      if (dist < 0.08) continue;
      const fill = 0.82 - dist * 0.42;
      if (Math.random() > fill) continue;

      const footprint = step * (0.42 + Math.random() * 0.34);
      // Taller toward the middle — classic downtown silhouette.
      const heightBias = Math.max(0, 1 - dist) ** 1.6;
      const h = 2 + Math.random() * 6 + heightBias * 34;

      // Strategic red: most of the city idles in dim monochrome,
      // a minority runs ember-hot, and a few are full alert towers.
      const roll = Math.random();
      const alert = roll > 0.94;
      let color = WHITE_DIM;
      let edge = 0x3c4150;
      if (alert) {
        color = RED;
        edge = 0xff4a55;
      } else if (roll > 0.82) {
        color = RED_DEEP;
        edge = 0x6e2028;
      } else if (roll > 0.74) {
        color = EMBER;
        edge = 0x7a3a2c;
      }

      out.push({
        x: cx + (Math.random() - 0.5) * step * 0.18,
        z: cz + (Math.random() - 0.5) * step * 0.18,
        w: footprint,
        d: footprint,
        h,
        color,
        edge,
        alert,
        beam: alert && h > 18 && Math.random() > 0.4,
        seed: Math.random() * 100,
      });
    }
  }
  return out;
}

/** Soft round sprite for additive data-packet glow. */
function makeDotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.7)");
  g.addColorStop(0.6, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Buildings({ data }: { data: Building[] }) {
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);
  const alertMats = useRef<THREE.MeshStandardMaterial[]>([]);

  // One material per building so alert towers can pulse independently.
  const mats = useMemo(() => {
    alertMats.current = [];
    return data.map((b) => {
      const m = new THREE.MeshStandardMaterial({
        color: 0x040406,
        emissive: new THREE.Color(b.color),
        emissiveIntensity: b.alert ? 0.95 : 0.2 + (b.seed % 1) * 0.16,
        metalness: 0.3,
        roughness: 0.55,
      });
      if (b.alert) alertMats.current.push(m);
      return m;
    });
  }, [data]);

  const edgeMats = useMemo(
    () =>
      data.map(
        (b) =>
          new THREE.LineBasicMaterial({
            color: new THREE.Color(b.edge),
            transparent: true,
            opacity: b.alert ? 0.95 : 0.45,
          })
      ),
    [data]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 0.55 + Math.abs(Math.sin(t * 2.4)) * 0.9;
    for (const m of alertMats.current) m.emissiveIntensity = pulse;
  });

  return (
    <group>
      {data.map((b, i) => (
        <group key={i} position={[b.x, b.h / 2, b.z]} scale={[b.w, b.h, b.d]}>
          <mesh geometry={boxGeo} material={mats[i]} />
          <lineSegments geometry={edgeGeo} material={edgeMats[i]} />
        </group>
      ))}
    </group>
  );
}

/** Vertical red uplink beams rising from alert towers — the swarm reporting in. */
function UplinkBeams({ data }: { data: Building[] }) {
  const beams = useMemo(() => data.filter((b) => b.beam).slice(0, 8), [data]);
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mats.current.forEach((m, i) => {
      if (m) m.opacity = 0.1 + Math.abs(Math.sin(t * 1.3 + i * 1.7)) * 0.22;
    });
  });
  return (
    <group>
      {beams.map((b, i) => (
        <mesh key={i} position={[b.x, b.h + 30, b.z]}>
          <cylinderGeometry args={[0.22, 0.5, 60, 6, 1, true]} />
          <meshBasicMaterial
            ref={(m) => { if (m) mats.current[i] = m; }}
            color={RED}
            transparent
            opacity={0.18}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Streams of additive points flowing along the street grid at a few altitudes. */
function DataPackets({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const tex = useMemo(() => makeDotTexture(), []);

  const { geometry, state } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const axis = new Int8Array(count); // 0 = travel X, 1 = travel Z
    const lane = new Float32Array(count); // fixed coord on the other axis
    const speed = new Float32Array(count);
    const yArr = new Float32Array(count);
    const span = 110;
    const white = new THREE.Color(0xd8dce6);
    const red = new THREE.Color(RED);
    const ember = new THREE.Color(EMBER);
    for (let i = 0; i < count; i++) {
      const a = Math.random() > 0.5 ? 1 : 0;
      axis[i] = a;
      lane[i] = (Math.round((Math.random() - 0.5) * 18) / 18) * span;
      const start = (Math.random() - 0.5) * span;
      yArr[i] = 1.2 + Math.random() * 26;
      speed[i] = (8 + Math.random() * 22) * (Math.random() > 0.5 ? 1 : -1);
      const px = a === 0 ? start : lane[i];
      const pz = a === 0 ? lane[i] : start;
      positions[i * 3] = px;
      positions[i * 3 + 1] = yArr[i];
      positions[i * 3 + 2] = pz;
      const roll = Math.random();
      const col = roll > 0.72 ? red : roll > 0.6 ? ember : white;
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry: g, state: { positions, axis, lane, speed, span } };
  }, [count]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { positions, axis, speed, span } = state;
    const lim = span / 2;
    for (let i = 0; i < count; i++) {
      const idx = i * 3 + (axis[i] === 0 ? 0 : 2);
      let v = positions[idx] + speed[i] * dt;
      if (v > lim) v = -lim;
      else if (v < -lim) v = lim;
      positions[idx] = v;
    }
    if (ref.current) (ref.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={2.6}
        map={tex}
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

/** Expanding sonar ring from the grid core — the autonomous monitoring sweep. */
function ScanPulse() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const period = 5;
    const p = (state.clock.elapsedTime % period) / period;
    const s = 2 + p * 95;
    if (ref.current) ref.current.scale.set(s, s, s);
    if (mat.current) mat.current.opacity = (1 - p) * 0.45;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
      <ringGeometry args={[0.94, 1, 96]} />
      <meshBasicMaterial ref={mat} color={RED} transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Central command spire at the core of the grid. */
function CoreBeacon() {
  const lightRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lightRef.current) {
      const m = lightRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.5 + Math.abs(Math.sin(t * 1.5)) * 0.5;
    }
  });
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 24, 0]}>
        <boxGeometry args={[2.2, 48, 2.2]} />
        <meshStandardMaterial color={0x040406} emissive={RED} emissiveIntensity={0.55} metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh ref={lightRef} position={[0, 49, 0]}>
        <sphereGeometry args={[1.4, 16, 16]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      <pointLight position={[0, 50, 0]} color={RED} intensity={2.6} distance={120} decay={1.4} />
    </group>
  );
}

function Starfield() {
  const geometry = useMemo(() => {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 220 + Math.random() * 160;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.5 + 0.4);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = 60 + Math.random() * 200;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geometry}>
      <pointsMaterial color={0xaab0c0} size={1.0} transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  );
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Scroll-choreographed cinematic camera.
 *
 * The flight path is a Catmull-Rom spline keyed to document scroll:
 *   0.00  high overwatch orbit (hero)
 *   0.25  dive toward the core spire
 *   0.45  street-level pass between the towers
 *   0.70  low sweep around the western district
 *   1.00  rise to full top-down grid overview
 * A slow time-based orbit (strongest at the hero) and pointer parallax are
 * layered on top so the city always feels alive, never on rails.
 */
function CameraRig() {
  const { camera, pointer } = useThree();
  const posCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(70, 50, 84),
          new THREE.Vector3(46, 28, 54),
          new THREE.Vector3(14, 7, 26),
          new THREE.Vector3(-26, 12, 30),
          new THREE.Vector3(-44, 34, -10),
          new THREE.Vector3(-6, 96, 50),
        ],
        false,
        "catmullrom",
        0.35
      ),
    []
  );
  const lookCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(0, 10, 0),
          new THREE.Vector3(0, 14, 0),
          new THREE.Vector3(0, 20, -8),
          new THREE.Vector3(8, 10, -4),
          new THREE.Vector3(4, 6, 4),
          new THREE.Vector3(0, 0, 0),
        ],
        false,
        "catmullrom",
        0.35
      ),
    []
  );
  const smooth = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const curLook = useMemo(() => new THREE.Vector3(0, 10, 0), []);

  useFrame((state, delta) => {
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const target = Math.min(1, Math.max(0, window.scrollY / max));
    smooth.current = THREE.MathUtils.damp(smooth.current, target, 2.2, delta);
    const p = smooth.current;
    const t = state.clock.elapsedTime;

    posCurve.getPoint(p, pos);
    // Orbit drift fades out as the dive begins; pointer parallax stays subtle.
    const drift = Math.max(0, 1 - p * 2.2);
    pos.applyAxisAngle(UP, t * 0.05 * drift + pointer.x * 0.3);
    pos.y += pointer.y * -5 * (0.3 + drift);

    camera.position.lerp(pos, 0.06);
    lookCurve.getPoint(p, look);
    curLook.lerp(look, 0.06);
    camera.lookAt(curLook);
  });
  return null;
}

function Scene({ density, packets }: { density: number; packets: number }) {
  const city = useMemo(() => buildCity(density), [density]);
  return (
    <>
      <color attach="background" args={[BG]} />
      <fogExp2 attach="fog" args={[BG, 0.0085]} />
      <ambientLight intensity={0.4} color={0x3a3a44} />
      <directionalLight position={[40, 60, 20]} intensity={0.25} color={0x665560} />
      <hemisphereLight args={[0x33161a, 0x040305, 0.45]} />
      <Starfield />
      <gridHelper args={[300, 60, RED_DEEP, 0x16161c]} position={[0, 0, 0]} />
      <Buildings data={city} />
      <UplinkBeams data={city} />
      <CoreBeacon />
      <ScanPulse />
      <DataPackets count={packets} />
      <CameraRig />
    </>
  );
}

export default function GridCity({ density = 22, packets = 220 }: { density?: number; packets?: number }) {
  return (
    <Canvas
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      dpr={[1, 2]}
      camera={{ position: [70, 48, 80], fov: 56, near: 0.1, far: 600 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Scene density={density} packets={packets} />
    </Canvas>
  );
}
