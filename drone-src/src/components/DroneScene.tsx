import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Waypoint } from "../types";

interface SceneProps {
  waypoints: Waypoint[];
  routeIndex: number;
  playing: boolean;
  speed: number;
  onRouteProgress: (value: number) => void;
}

function makeRoute(waypoints: Waypoint[]) {
  const points = waypoints.map(
    (wp) => new THREE.Vector3(...wp.position),
  );

  return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
}

function CameraRoute({
  waypoints,
  routeIndex,
  playing,
  speed,
  onRouteProgress,
}: SceneProps) {
  const { camera } = useThree();
  const tRef = useRef(
    routeIndex / Math.max(1, waypoints.length - 1),
  );

  const route = useMemo(() => makeRoute(waypoints), [waypoints]);
  const lookVector = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    tRef.current = routeIndex / Math.max(1, waypoints.length - 1);
  }, [routeIndex, waypoints.length]);

  useFrame((_, delta) => {
    if (playing) {
      tRef.current = Math.min(
        0.9999,
        tRef.current + delta * 0.034 * speed,
      );
    }

    const position = route.getPointAt(tRef.current);
    const lookT = Math.min(0.9999, tRef.current + 0.025);
    const target = route.getPointAt(lookT);

    camera.position.lerp(position, 0.18);
    lookVector.lerp(target, 0.25);
    camera.lookAt(lookVector);

    onRouteProgress(tRef.current);
  });

  return null;
}

function Wall({
  position,
  size,
  color = "#d9d7d0",
}: {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

function Furniture({
  position,
  size,
  color,
  rotation = 0,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: number;
}) {
  return (
    <mesh position={position} rotation={[0, rotation, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.65} />
    </mesh>
  );
}

function PhotoPanel({
  position,
  rotation = [0, 0, 0],
  size = [2.4, 1.5],
  imageUrl,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  size?: [number, number];
  imageUrl: string;
}) {
  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [imageUrl]);

  return (
    <group position={position} rotation={rotation}>
      {/* Sleek architectural gold frame */}
      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[size[0] + 0.08, size[1] + 0.08]} />
        <meshStandardMaterial color="#c9a86a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Real Estate Photograph Surface */}
      <mesh>
        <planeGeometry args={size} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PropertyShell() {
  const floorHeight = 2.65;
  const levelBottoms = [-1.45, 1.45, 4.0];

  return (
    <group>
      {/* 3D Real Estate Photo Portals across the Flight Path */}
      {/* 1. Rear Entrance / Backyard Grounds */}
      <PhotoPanel
        position={[0, 2.2, 7.8]}
        rotation={[0, 0, 0]}
        size={[2.6, 1.6]}
        imageUrl="./interiors/backyard.jpg"
      />
      {/* 2. Main Entry / Foyer Daylight Exterior */}
      <PhotoPanel
        position={[0.2, 2.3, 4.98]}
        rotation={[0, Math.PI, 0]}
        size={[2.5, 1.5]}
        imageUrl="./interiors/exterior-day.jpg"
      />
      {/* 3. Kitchen & Waterfall Island */}
      <PhotoPanel
        position={[-3.98, 2.45, -1.8]}
        rotation={[0, Math.PI / 2, 0]}
        size={[2.8, 1.6]}
        imageUrl="./interiors/kitchen.jpg"
      />
      {/* 4. Living Room Hearth & Brick Fireplace */}
      <PhotoPanel
        position={[2.65, 2.35, 4.98]}
        rotation={[0, Math.PI, 0]}
        size={[2.8, 1.6]}
        imageUrl="./interiors/living.jpg"
      />
      {/* 5. Living Room Japandi Virtual Staging */}
      <PhotoPanel
        position={[2.0, 2.35, 0.1]}
        rotation={[0, -Math.PI / 2, 0]}
        size={[2.2, 1.3]}
        imageUrl="./interiors/living-staged.jpg"
      />
      {/* 6. Finished Lower Level Rec Room */}
      <PhotoPanel
        position={[-2.2, -0.15, -4.98]}
        rotation={[0, 0, 0]}
        size={[3.2, 1.8]}
        imageUrl="./interiors/lower-level.jpg"
      />
      {/* 7. Primary Bedroom Suite */}
      <PhotoPanel
        position={[-2.15, 5.25, -4.98]}
        rotation={[0, 0, 0]}
        size={[2.8, 1.6]}
        imageUrl="./interiors/bedroom.jpg"
      />
      {/* 8. High-Altitude Aerial Orbit on Roof deck */}
      <PhotoPanel
        position={[0.5, 8.2, -4.9]}
        rotation={[0, 0, 0]}
        size={[3.6, 2.0]}
        imageUrl="./interiors/aerial.jpg"
      />
      {/* 9. Twilight Dusk Exterior */}
      <PhotoPanel
        position={[0.5, 8.2, 4.9]}
        rotation={[0, Math.PI, 0]}
        size={[3.6, 2.0]}
        imageUrl="./interiors/exterior-dusk.jpg"
      />
      {/* floor slabs */}
      {levelBottoms.map((y) => (
        <mesh key={y} position={[0, y - 0.08, 0]}>
          <boxGeometry args={[8.2, 0.15, 10.2]} />
          <meshStandardMaterial color="#8e5f37" roughness={0.7} />
        </mesh>
      ))}

      {/* exterior walls, intentionally open on the rear for the drone entry */}
      {levelBottoms.map((y) => (
        <group key={y}>
          <Wall position={[-4.1, y + 1.3, 0]} size={[0.18, floorHeight, 10.2]} />
          <Wall position={[4.1, y + 1.3, 0]} size={[0.18, floorHeight, 10.2]} />
          <Wall position={[0, y + 1.3, 5.1]} size={[8.2, floorHeight, 0.18]} />
          {y !== 1.45 && (
            <Wall position={[0, y + 1.3, -5.1]} size={[8.2, floorHeight, 0.18]} />
          )}
        </group>
      ))}

      {/* main level room dividers */}
      <Wall position={[-0.8, 2.78, 0]} size={[0.16, floorHeight, 7.7]} />
      <Wall position={[2.05, 2.78, 2.45]} size={[0.16, floorHeight, 5.1]} />
      <Wall position={[3.0, 2.78, -2.95]} size={[2.2, floorHeight, 0.16]} />
      <Wall position={[3.95, 2.78, -2.45]} size={[0.16, floorHeight, 2.1]} />

      {/* basement */}
      <Wall position={[0.6, -0.15, 0]} size={[0.16, floorHeight, 8.0]} />
      <Wall position={[-2.5, -0.15, 2.25]} size={[2.8, floorHeight, 0.16]} />
      <Wall position={[2.45, -0.15, 2.75]} size={[3.1, floorHeight, 0.16]} />
      <Wall position={[3.95, -0.15, 3.75]} size={[0.16, floorHeight, 1.9]} />

      {/* upper floor */}
      <Wall position={[0.2, 5.35, 0]} size={[0.16, floorHeight, 8.0]} />
      <Wall position={[-2.2, 5.35, 2.4]} size={[3.8, floorHeight, 0.16]} />
      <Wall position={[2.25, 5.35, 2.4]} size={[2.7, floorHeight, 0.16]} />
      <Wall position={[3.85, 5.35, 3.55]} size={[0.16, floorHeight, 2.1]} />
      <Wall position={[-2.15, 5.35, -2.8]} size={[3.8, floorHeight, 0.16]} />
      <Wall position={[-0.2, 5.35, -4.15]} size={[0.16, floorHeight, 2.0]} />
      <Wall position={[1.6, 5.35, -3.0]} size={[0.16, floorHeight, 4.3]} />
      <Wall position={[3.85, 5.35, -3.65]} size={[0.16, floorHeight, 3.0]} />

      {/* kitchen */}
      <Furniture
        position={[0.65, 2.25, -2.05]}
        size={[2.85, 0.95, 1.05]}
        color="#5b331d"
      />
      <Furniture
        position={[-2.8, 2.25, -2.5]}
        size={[1.8, 0.95, 3.7]}
        color="#5b331d"
      />
      <Furniture
        position={[-3.25, 2.35, -4.15]}
        size={[0.62, 1.75, 0.62]}
        color="#73777b"
      />
      <Furniture
        position={[-2.45, 2.35, -4.15]}
        size={[0.62, 1.75, 0.62]}
        color="#383b40"
      />

      {/* dining */}
      <Furniture
        position={[0.2, 2.25, 0.6]}
        size={[2.15, 0.12, 1.05]}
        color="#5b331d"
      />

      {/* living room */}
      <Furniture
        position={[2.65, 1.95, 3.25]}
        size={[2.5, 0.9, 0.92]}
        color="#74706a"
      />
      <Furniture
        position={[2.65, 1.55, 2.05]}
        size={[1.35, 0.12, 0.8]}
        color="#5b331d"
      />
      <Furniture
        position={[2.65, 1.7, 4.65]}
        size={[2.6, 0.65, 0.32]}
        color="#271e19"
      />

      {/* bedrooms */}
      <Furniture position={[-2.1, 4.0, 2.0]} size={[1.95, 0.65, 1.15]} color="#5b331d" />
      <Furniture position={[-2.1, 4.0, -2.45]} size={[1.75, 0.65, 1.15]} color="#5b331d" />
      <Furniture position={[-2.15, 4.0, -1.55]} size={[2.4, 0.65, 1.35]} color="#5b331d" />
      <Furniture position={[0.45, 4.0, -1.0]} size={[1.15, 2.0, 1.65]} color="#4e2c1b" />

      {/* bathroom fixtures */}
      <Furniture position={[3.35, 2.0, -2.75]} size={[1.0, 0.85, 0.45]} color="#654126" />
      <Furniture position={[3.5, 1.85, -4.0]} size={[0.6, 0.75, 0.95]} color="#e0e0da" />
      <Furniture position={[2.8, 4.65, 3.0]} size={[1.25, 0.5, 0.45]} color="#654126" />
      <Furniture position={[3.5, 4.45, 3.55]} size={[0.6, 0.75, 0.95]} color="#e0e0da" />
      <Furniture position={[2.75, 4.7, -2.3]} size={[1.4, 0.5, 0.45]} color="#654126" />
      <Furniture position={[2.75, 4.45, -4.0]} size={[0.6, 0.75, 0.95]} color="#e0e0da" />

      {/* roof deck */}
      <mesh position={[0, 6.95, 0]}>
        <boxGeometry args={[8.2, 0.12, 10.2]} />
        <meshStandardMaterial color="#8e5f37" roughness={0.7} />
      </mesh>
      {[[-4, 7.5, 0], [4, 7.5, 0], [0, 7.5, 5], [0, 7.5, -5]].map(
        ([x, y, z], index) => (
          <mesh key={index} position={[x, y, z]}>
            <boxGeometry args={index < 2 ? [0.07, 1.35, 10] : [8, 1.35, 0.07]} />
            <meshStandardMaterial color="#30353b" metalness={0.5} roughness={0.4} />
          </mesh>
        ),
      )}
    </group>
  );
}

function SceneEnvironment() {
  return (
    <>
      <color attach="background" args={["#101419"]} />
      <ambientLight intensity={0.9} />
      <pointLight position={[0, 8, 0]} intensity={1300} distance={28} />
      <pointLight position={[-3, 2, 2]} intensity={850} distance={18} color="#fff1d8" />
      <pointLight position={[3, 4, -3]} intensity={700} distance={18} color="#dcecff" />
      <hemisphereLight args={["#dce8f4", "#1a120e", 1.15]} />
    </>
  );
}

export default function DroneScene(props: SceneProps) {
  return (
    <Canvas
      camera={{ position: props.waypoints[0].position, fov: 72, near: 0.03, far: 120 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <SceneEnvironment />
      <PropertyShell />
      <CameraRoute {...props} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan
        minDistance={0.5}
        maxDistance={20}
      />
    </Canvas>
  );
}
