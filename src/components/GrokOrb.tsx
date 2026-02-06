import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float, Stars } from "@react-three/drei";
import * as THREE from "three";

interface GrokOrbMeshProps {
  isGenerating: boolean;
}

const GrokOrbMesh: React.FC<GrokOrbMeshProps> = ({ isGenerating }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);

  const cyanColor = useMemo(() => new THREE.Color(0x00ffff), []);
  const magentaColor = useMemo(() => new THREE.Color(0xff00ff), []);
  const purpleColor = useMemo(() => new THREE.Color(0x9945ff), []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const speed = isGenerating ? 3 : 1;
    const intensity = isGenerating ? 1.5 : 1;

    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.3 * speed;
      meshRef.current.rotation.x = Math.sin(t * 0.2 * speed) * 0.1;
      const scale = intensity * (1 + Math.sin(t * 2 * speed) * (isGenerating ? 0.08 : 0.03));
      meshRef.current.scale.setScalar(scale);
    }

    if (glowRef.current) {
      const glowScale = intensity * (1.3 + Math.sin(t * 1.5 * speed) * 0.1);
      glowRef.current.scale.setScalar(glowScale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.08 + Math.sin(t * 2 * speed) * 0.04;
    }

    if (ringRef.current) {
      ringRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.5) * 0.3;
      ringRef.current.rotation.z = t * 0.5 * speed;
    }

    if (ring2Ref.current) {
      ring2Ref.current.rotation.x = Math.PI / 3 + Math.cos(t * 0.4) * 0.2;
      ring2Ref.current.rotation.z = -t * 0.3 * speed;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.3} floatIntensity={0.5}>
      <group>
        {/* Core orb */}
        <Sphere ref={meshRef} args={[1, 64, 64]}>
          <MeshDistortMaterial
            color={cyanColor}
            emissive={cyanColor}
            emissiveIntensity={isGenerating ? 0.8 : 0.3}
            roughness={0.1}
            metalness={0.9}
            distort={isGenerating ? 0.5 : 0.25}
            speed={isGenerating ? 8 : 3}
            transparent
            opacity={0.9}
          />
        </Sphere>

        {/* Inner glow */}
        <Sphere ref={glowRef} args={[1.3, 32, 32]}>
          <meshBasicMaterial
            color={isGenerating ? magentaColor : cyanColor}
            transparent
            opacity={0.08}
            side={THREE.BackSide}
          />
        </Sphere>

        {/* Orbital ring 1 */}
        <mesh ref={ringRef}>
          <torusGeometry args={[1.6, 0.015, 16, 100]} />
          <meshBasicMaterial
            color={cyanColor}
            transparent
            opacity={isGenerating ? 0.9 : 0.4}
          />
        </mesh>

        {/* Orbital ring 2 */}
        <mesh ref={ring2Ref}>
          <torusGeometry args={[1.9, 0.01, 16, 100]} />
          <meshBasicMaterial
            color={purpleColor}
            transparent
            opacity={isGenerating ? 0.7 : 0.25}
          />
        </mesh>

        {/* Point light from orb */}
        <pointLight
          color={isGenerating ? 0xff00ff : 0x00ffff}
          intensity={isGenerating ? 2 : 0.8}
          distance={6}
          decay={2}
        />
      </group>
    </Float>
  );
};

interface GrokOrbProps {
  isGenerating: boolean;
  className?: string;
}

const GrokOrb: React.FC<GrokOrbProps> = ({ isGenerating, className = "" }) => {
  return (
    <div className={`relative ${className}`}>
      {/* Ambient glow behind canvas */}
      <div
        className={`absolute inset-0 rounded-full blur-3xl transition-all duration-1000 ${
          isGenerating ? "opacity-40 scale-110" : "opacity-15"
        }`}
        style={{
          background: isGenerating
            ? "radial-gradient(circle, hsl(300 100% 60% / 0.6), hsl(180 100% 50% / 0.3), transparent)"
            : "radial-gradient(circle, hsl(180 100% 50% / 0.4), transparent)",
        }}
      />

      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 5, 5]} intensity={0.5} color={0x00ffff} />
        <directionalLight position={[-5, -3, 3]} intensity={0.3} color={0xff00ff} />
        <Stars
          radius={50}
          depth={30}
          count={isGenerating ? 800 : 300}
          factor={2}
          saturation={1}
          fade
          speed={isGenerating ? 3 : 0.5}
        />
        <GrokOrbMesh isGenerating={isGenerating} />
      </Canvas>

      {/* Status text */}
      <div className="absolute bottom-2 left-0 right-0 text-center">
        <span
          className={`font-mono-share text-[9px] tracking-widest transition-all duration-500 ${
            isGenerating ? "neon-text-magenta animate-flicker" : "text-muted-foreground/40"
          }`}
        >
          {isGenerating ? "◉ NEURAL_PROCESSING" : "◎ GROK_STANDBY"}
        </span>
      </div>
    </div>
  );
};

export default GrokOrb;
