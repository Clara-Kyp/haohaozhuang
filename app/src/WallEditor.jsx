import React from 'react';
import { RoundedBox, Edges } from '@react-three/drei';
import { wallPose } from './wallObjects';

export function WallSelection({ target, width, depth, height }) {
  let pose, size;
  if (['north','south','west','east'].includes(target)) {
    pose = wallPose(target,width,depth,height/2);
    size = [['north','south'].includes(target) ? width-.02 : depth-.02,height-.02];
  } else if (target==='floor' || target==='ceiling') {
    pose={position:[0,target==='floor'?.015:height-.015,0],rotation:[target==='floor'?-Math.PI/2:Math.PI/2,0,0]};
    size=[width-.02,depth-.02];
  }
  if (!pose) return null;
  return <group {...pose} userData={{editorOnly:true,excludeFromAO:true}}>
    <mesh raycast={()=>null}><planeGeometry args={size}/><meshBasicMaterial color="#378566" transparent opacity={.08} depthWrite={false}/>
      <Edges color="#337b5b" raycast={()=>null} />
    </mesh>
  </group>;
}

export function Television({ data, onSelect }) {
  const tv = data.tv;
  if (!tv?.enabled) return null;
  const pose = wallPose(tv.wall,data.width,data.depth,tv.centerHeight,tv.offset);
  if (!pose) return null;
  return <group {...pose} onClick={e=>{e.stopPropagation();onSelect('tv');}}>
    <mesh position={[0,0,-.016]} castShadow><boxGeometry args={[.25,.18,.035]}/><meshStandardMaterial color="#2a3030" roughness={.7}/></mesh>
    <RoundedBox args={[tv.width,tv.height,.045]} radius={.013} castShadow receiveShadow>
      <meshStandardMaterial color="#181d1f" roughness={.3} metalness={.15}/>
    </RoundedBox>
    <mesh position={[0,0,.024]}><planeGeometry args={[tv.width-.028,tv.height-.028]}/>
      <meshPhysicalMaterial color="#10191d" roughness={.15} metalness={.3} clearcoat={.4}/>
    </mesh>
  </group>;
}
