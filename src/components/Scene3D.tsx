"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  Sparkles,
  RoundedBox,
  Edges,
  Environment,
  Lightformer,
} from "@react-three/drei";
import { BackSide, type Group } from "three";

// A glossy candy-yellow toy die with a thick black cartoon outline. Idles with a
// big bouncy float and tumbles fast while `spinning` is true.
function Die({ spinning }: { spinning: boolean }) {
  const group = useRef<Group>(null);
  const speed = useRef(0.45);

  useFrame((_, delta) => {
    const target = spinning ? 11 : 0.45;
    speed.current += (target - speed.current) * Math.min(delta * 2.5, 1);
    if (group.current) {
      group.current.rotation.x += speed.current * delta;
      group.current.rotation.y += speed.current * delta * 1.2;
      group.current.rotation.z += speed.current * delta * 0.4;
    }
  });

  return (
    <group ref={group}>
      {/* toon outline via an inverted-hull back-face box */}
      <RoundedBox args={[1.86, 1.86, 1.86]} radius={0.33} smoothness={5}>
        <meshBasicMaterial color="#17120c" side={BackSide} />
      </RoundedBox>
      {/* glossy candy die */}
      <RoundedBox args={[1.7, 1.7, 1.7]} radius={0.3} smoothness={6}>
        <meshStandardMaterial color="#ffc83d" roughness={0.22} metalness={0.05} />
        <Edges threshold={25} color="#17120c" />
      </RoundedBox>
    </group>
  );
}

export default function Scene3D({ spinning }: { spinning: boolean }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 5.2], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 6, 4]} intensity={2.4} />
      <pointLight position={[-4, -2, 3]} intensity={25} color="#ff7eb3" />
      <pointLight position={[3, -1, 2]} intensity={18} color="#3d7bff" />

      <Float speed={3} rotationIntensity={0.7} floatIntensity={1.8}>
        <Die spinning={spinning} />
      </Float>

      <Sparkles
        count={40}
        scale={7}
        size={4}
        speed={0.4}
        color="#ff5436"
        opacity={0.8}
      />

      {/* light procedural environment for the plastic gloss (no HDR download) */}
      <Environment resolution={64}>
        <Lightformer
          form="rect"
          intensity={2}
          position={[3, 3, 4]}
          scale={6}
          color="#ffffff"
        />
        <Lightformer
          form="rect"
          intensity={1.3}
          position={[-3, 1, 3]}
          scale={4}
          color="#ffe9b0"
        />
      </Environment>
    </Canvas>
  );
}
