import React from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import SurfaceMaterial from './SurfaceMaterial';

export default function Rug({ width, depth, height, color }) {
  const binding = Math.min(.022, width * .04, depth * .04);
  const backing = height * .72;
  const pileSize = [width - binding * 2, depth - binding * 2];
  const edgeColor = new THREE.Color(color).multiplyScalar(.62);

  return <>
    <RoundedBox args={[width, depth, backing]} position={[0, backing / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}
      radius={Math.min(backing / 2, .008)} smoothness={2} receiveShadow>
      <meshStandardMaterial color={edgeColor} roughness={.98} />
    </RoundedBox>
    {/* Extrude the top face in its own plane so the generated UVs are measured in meters. */}
    <RoundedBox args={[pileSize[0], pileSize[1], height]} position={[0, height / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}
      radius={Math.min(height / 2, .01)} smoothness={2} receiveShadow>
      <SurfaceMaterial name="布艺地毯" color={color} />
    </RoundedBox>
  </>;
}
