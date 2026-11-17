import { publicAsset } from './deployment';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/** 6mm 玻璃：高透射、低粗糙度；真实房间探针提供随观察角度变化的反射。 */
function Glazing({ width, height, centerY, z, revision }) {
  const panes = useRef(null);
  const dirty = useRef(2);
  const { scene, gl } = useThree();
  const probe = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(128, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    return { target, camera: new THREE.CubeCamera(.06, 100, target) };
  }, []);
  useEffect(() => {
    probe.camera.position.set(0, centerY, z + .18);
    dirty.current = 2;
  }, [probe, centerY, z, revision]);
  useFrame(() => {
    if (!dirty.current || !panes.current) return;
    // 不捕捉玻璃自己；变更家具/材质时重算两帧，转动视角不重复进行六面渲染。
    panes.current.visible = false;
    try { probe.camera.update(gl, scene); }
    finally { panes.current.visible = true; }
    dirty.current--;
  }, -.5);
  useEffect(() => () => probe.target.dispose(), [probe]);
  const paneWidth = (width - .15) / 2;
  return <group ref={panes} userData={{ excludeFromAO: true }}>
    {[-1, 1].map(side => <mesh key={side}
      position={[side * (paneWidth + .045) / 2, centerY, z]} receiveShadow={false}>
      <boxGeometry args={[paneWidth, height - .09, .006]} />
      <meshPhysicalMaterial color="#ffffff" metalness={0} roughness={.045}
        transmission={.97} opacity={1} thickness={.006} ior={1.5}
        attenuationColor="#d6e8df" attenuationDistance={1.5}
        envMap={probe.target.texture} envMapIntensity={1.1} />
    </mesh>)}
  </group>;
}

function FrameBar({ size, position, color = '#737b79', metalness = .6, roughness = .3 }) {
  return <mesh position={position} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
  </mesh>;
}

export default function WindowAssembly({ width: roomWidth, height: roomHeight, depth, revision, onSelect }) {
  const width = roomWidth * .62, height = roomHeight * .6;
  const centerY = roomHeight * .55, z = -depth / 2 - .015;
  const exterior = useLoader(HDRLoader, publicAsset('/textures/rooitou_park_1k.hdr'));
  return <group onClick={e => { e.stopPropagation(); onSelect('north'); }}>
    {/* CC0 实拍全景在室外远处，保留窗外纵深；这是示意景观，不对应用户地址。 */}
    <mesh rotation={[0, 1.9, 0]} userData={{ excludeFromAO: true,excludeFromExport:true }}>
      <sphereGeometry args={[65, 48, 24]} />
      <meshBasicMaterial map={exterior} side={THREE.BackSide} color="#c8d1d8" />
    </mesh>
    <Glazing width={width} height={height} centerY={centerY} z={z} revision={revision} />
    {[-1, 1].map(side => <group key={side}>
      <FrameBar size={[.048, height + .05, .12]} position={[side * width / 2, centerY, z]} />
      <FrameBar size={[width + .048, .045, .12]} position={[0, centerY + side * height / 2, z]} />
      {/* 窗框内胶条，避免玻璃直接接到墙上。 */}
      <FrameBar size={[.012, height - .05, .02]} position={[side * (width / 2 - .035), centerY, z + .045]}
        color="#353c3b" metalness={0} roughness={.8} />
      {Array.from({ length: 9 }, (_, i) => <mesh key={i}
        position={[side * (width / 2 + .07 - i * .038), centerY - roomHeight * .06,
          z + .18 + (i % 2) * .035]}>
        <planeGeometry args={[.055, roomHeight * .73]} />
        <meshPhysicalMaterial color="#f1ede4" roughness={1} transparent opacity={.65}
          side={THREE.DoubleSide} depthWrite={false} sheen={.3} />
      </mesh>)}
    </group>)}
    <FrameBar size={[.048, height, .12]} position={[0, centerY, z]} />
    <FrameBar size={[width + .2, .035, .28]} position={[0, centerY - height / 2 - .035, z + .07]}
      color="#d9d2c5" metalness={0} roughness={.5} />
    <FrameBar size={[.018, .13, .025]} position={[.058, centerY - .12, z + .09]} />
    <FrameBar size={[.07, .018, .035]} position={[.08, centerY - .17, z + .095]} />
  </group>;
}
