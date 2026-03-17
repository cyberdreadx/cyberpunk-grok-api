import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float, Stars } from "@react-three/drei";
import * as THREE from "three";
import { useIsMobile } from "@/hooks/use-mobile";

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

        <Sphere ref={glowRef} args={[1.3, 32, 32]}>
          <meshBasicMaterial
            color={isGenerating ? magentaColor : cyanColor}
            transparent
            opacity={0.08}
            side={THREE.BackSide}
          />
        </Sphere>

        <mesh ref={ringRef}>
          <torusGeometry args={[1.6, 0.015, 16, 100]} />
          <meshBasicMaterial
            color={cyanColor}
            transparent
            opacity={isGenerating ? 0.9 : 0.4}
          />
        </mesh>

        <mesh ref={ring2Ref}>
          <torusGeometry args={[1.9, 0.01, 16, 100]} />
          <meshBasicMaterial
            color={purpleColor}
            transparent
            opacity={isGenerating ? 0.7 : 0.25}
          />
        </mesh>

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

/**
 * Lightweight CSS-only orb for mobile — zero WebGL contexts, zero GPU
 * vertex displacement, zero requestAnimationFrame loops.
 */
const CSSOrb: React.FC<{ isGenerating: boolean }> = ({ isGenerating }) => (
  <div className="relative w-full h-full flex items-center justify-center">
    <div
      className={`absolute rounded-full transition-transform duration-1000 ${
        isGenerating ? "scale-110" : "scale-100"
      }`}
      style={{
        width: "80%",
        height: "80%",
        background: isGenerating
          ? "radial-gradient(circle, hsl(300 100% 60% / 0.35), hsl(180 100% 50% / 0.15), transparent 70%)"
          : "radial-gradient(circle, hsl(180 100% 50% / 0.25), transparent 70%)",
        filter: "blur(20px)",
        animation: isGenerating ? "cssorb-pulse 2s ease-in-out infinite" : undefined,
      }}
    />
    <div
      className="relative rounded-full"
      style={{
        width: "55%",
        height: "55%",
        background: isGenerating
          ? "radial-gradient(circle at 35% 35%, hsl(180 100% 70%), hsl(270 80% 55%) 60%, hsl(300 100% 40%) 100%)"
          : "radial-gradient(circle at 35% 35%, hsl(180 100% 65%), hsl(200 80% 40%) 70%, hsl(220 60% 25%) 100%)",
        boxShadow: isGenerating
          ? "0 0 30px hsl(300 100% 60% / 0.5), 0 0 60px hsl(180 100% 50% / 0.25), inset 0 0 20px hsl(180 100% 70% / 0.3)"
          : "0 0 20px hsl(180 100% 50% / 0.3), inset 0 0 15px hsl(180 100% 70% / 0.2)",
        animation: isGenerating ? "cssorb-spin 4s linear infinite" : "cssorb-spin 12s linear infinite",
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          top: "15%",
          left: "20%",
          width: "30%",
          height: "25%",
          background: "radial-gradient(ellipse, hsl(180 100% 95% / 0.6), transparent)",
          filter: "blur(4px)",
        }}
      />
    </div>
    <div
      className="absolute rounded-full border"
      style={{
        width: "72%",
        height: "72%",
        borderColor: isGenerating ? "hsl(180 100% 50% / 0.6)" : "hsl(180 100% 50% / 0.25)",
        animation: isGenerating ? "cssorb-ring 3s linear infinite" : "cssorb-ring 8s linear infinite",
        transform: "rotateX(65deg)",
      }}
    />
    <div
      className="absolute rounded-full border"
      style={{
        width: "85%",
        height: "85%",
        borderColor: isGenerating ? "hsl(270 80% 60% / 0.45)" : "hsl(270 80% 60% / 0.15)",
        animation: isGenerating ? "cssorb-ring 5s linear infinite reverse" : "cssorb-ring 14s linear infinite reverse",
        transform: "rotateX(55deg) rotateY(20deg)",
      }}
    />
  </div>
);

interface GrokOrbProps {
  isGenerating: boolean;
  className?: string;
}

const GrokOrb: React.FC<GrokOrbProps> = ({ isGenerating, className = "" }) => {
  const isMobile = useIsMobile();

  return (
    <div className={`relative ${className}`}>
      {isMobile ? (
        <CSSOrb isGenerating={isGenerating} />
      ) : (
        <>
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
        </>
      )}

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
