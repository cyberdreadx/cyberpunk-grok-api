import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * GridCity — a living, neon "GLTCH grid" rendered with react-three-fiber.
 *
 * The city is a metaphor for the platform: each tower is a node on the grid,
 * data packets stream between districts, and a handful of red "alert" towers
 * pulse like a mission-control board. Pure three.js + R3F — no extra deps,
 * no post-processing (the neon look comes from emissive faces + additive
 * packet sprites over a dark, fogged scene).
 */

const BG = 0x05060d;
const CYAN = 0x16e0e6;
const MAGENTA = 0xff2dd0;
const PURPLE = 0x9b5cff;
const RED = 0xff2a3a;

type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  edge: number;
  alert: boolean;
  seed: number;
};

/** Build a skyline on a street grid, denser toward the center. */
function buildCity(density: number): Building[] {
  const out: Building[] = [];
  const cells = density; // cells per axis
  const span = 110;
  const step = span / cells;
  const half = span / 2;
  let i = 0;
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      i++;
      const cx = -half + gx * step + step / 2;
      const cz = -half + gz * step + step / 2;
      const dist = Math.hypot(cx, cz) / half; // 0 center .. ~1.4 edge
      // Leave the very center open for a "core" beacon, skip some cells for streets.
      if (dist < 0.08) continue;
      const fill = 0.82 - dist * 0.42;
      if (Math.random() > fill) continue;

      const footprint = step * (0.42 + Math.random() * 0.34);
      // Taller toward the middle — classic downtown silhouette.
      const heightBias = Math.max(0, 1 - dist) ** 1.6;
      const h = 2 + Math.random() * 6 + heightBias * 34;

      const roll = Math.random();
      const alert = roll > 0.93;
      let color = CYAN;
      let edge = 0x5cf6ff;
      if (alert) {
        color = RED;
        edge = 0xff5a66;
      } else if (roll > 0.74) {
        color = MAGENTA;
        edge = 0xff7ae6;
      } else if (roll > 0.6) {
        color = PURPLE;
        edge = 0xc59bff;
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
        color: 0x05070c,
        emissive: new THREE.Color(b.color),
        emissiveIntensity: b.alert ? 0.9 : 0.32 + (b.seed % 1) * 0.22,
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
            opacity: b.alert ? 0.95 : 0.6,
          })
      ),
    [data]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 0.55 + Math.abs(Math.sin(t * 2.4)) * 0.85;
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
    const cyan = new THREE.Color(CYAN);
    const mag = new THREE.Color(MAGENTA);
    const red = new THREE.Color(RED);
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
      const col = roll > 0.9 ? red : roll > 0.6 ? mag : cyan;
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

/** Expanding sonar ring from the grid core — the "live scan" pulse. */
function ScanPulse() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const period = 5;
    const p = (state.clock.elapsedTime % period) / period;
    const s = 2 + p * 95;
    if (ref.current) ref.current.scale.set(s, s, s);
    if (mat.current) mat.current.opacity = (1 - p) * 0.5;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
      <ringGeometry args={[0.94, 1, 96]} />
      <meshBasicMaterial ref={mat} color={CYAN} transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Central beacon tower at the core of the grid. */
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
        <meshStandardMaterial color={0x05070c} emissive={CYAN} emissiveIntensity={0.5} metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh ref={lightRef} position={[0, 49, 0]}>
        <sphereGeometry args={[1.4, 16, 16]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      <pointLight position={[0, 50, 0]} color={CYAN} intensity={2.4} distance={120} decay={1.4} />
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
      <pointsMaterial color={0x9fb8ff} size={1.1} transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/** Slow auto-orbit with subtle pointer parallax. */
function CameraRig() {
  const { camera, pointer } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const radius = 86;
    const angle = t * 0.045 + pointer.x * 0.35;
    target.set(
      Math.sin(angle) * radius,
      40 + pointer.y * -7,
      Math.cos(angle) * radius
    );
    camera.position.lerp(target, 0.04);
    camera.lookAt(0, 9, 0);
  });
  return null;
}

function Scene({ density, packets }: { density: number; packets: number }) {
  const city = useMemo(() => buildCity(density), [density]);
  return (
    <>
      <color attach="background" args={[BG]} />
      <fogExp2 attach="fog" args={[BG, 0.0085]} />
      <ambientLight intensity={0.45} color={0x4060a0} />
      <directionalLight position={[40, 60, 20]} intensity={0.3} color={0x6080ff} />
      <hemisphereLight args={[0x2040ff, 0x050308, 0.4]} />
      <Starfield />
      <gridHelper args={[300, 60, CYAN, 0x14304a]} position={[0, 0, 0]} />
      <Buildings data={city} />
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
