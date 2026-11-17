import React from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import SurfaceMaterial from './SurfaceMaterial';

function Box({ size, at = [0,0,0], color = '#e6e0d5', surface, radius = .012, ...props }) {
  return <RoundedBox args={size} radius={radius} smoothness={2} position={at} castShadow receiveShadow {...props}>
    {surface ? <SurfaceMaterial name={surface} color={color} size={[size[0],size[2]]} />
      : <meshStandardMaterial color={color} roughness={.5} />}
  </RoundedBox>;
}
function Chair({ at, rotation = 0 }) {
  return <group position={at} rotation={[0,rotation,0]}>
    <Box size={[.38,.045,.38]} at={[0,.44,0]} color="#8c7459" surface="橡木" />
    <Box size={[.38,.4,.035]} at={[0,.65,-.17]} color="#b8aa95" />
    {[-1,1].flatMap(a=>[-1,1].map(b=><Box key={a+':'+b} size={[.03,.42,.03]} at={[a*.15,.21,b*.15]} color="#80654c" />))}
  </group>;
}
function Faucet({ at }) {
  return <group position={at}>
    <mesh position={[0,.1,0]} castShadow><cylinderGeometry args={[.012,.012,.2,12]} /><meshStandardMaterial color="#c4ccce" metalness={1} roughness={.18}/></mesh>
    <mesh position={[0,.19,.055]} castShadow><boxGeometry args={[.025,.025,.13]}/><meshStandardMaterial color="#c4ccce" metalness={1} roughness={.18}/></mesh>
  </group>;
}

export function ProceduralItem({ item }) {
  const {kind, width:w, depth:d, height:h} = item;
  if (kind === 'bed') return <>
    <Box size={[w,.24,d]} at={[0,.17,0]} color="#b89a72" surface="橡木" radius={.035}/>
    <Box size={[w+.01,.2,d-.04]} at={[0,.37,0]} color="#eee9df" surface="布艺" radius={.07}/>
    <Box size={[w,.06,d*.65]} at={[0,.49,d*.13]} color="#c7bca4" surface="布艺" radius={.025}/>
    <Box size={[w,.85,.09]} at={[0,.49,-d/2+.025]} color="#bdac92" surface="布艺" radius={.035}/>
    {[-1,1].map(side=><Box key={side} size={[w*.39,.12,.35]} at={[side*w*.235,.51,-d*.32]} color="#f0ece2" surface="布艺" radius={.045}/>)}
  </>;
  if (kind === 'bookshelf') return <>
    {[-1,1].map(side=><Box key={side} size={[.035,h,d]} at={[side*(w/2-.0175),h/2,0]} color="#aa8c65" surface="橡木"/>)}
    <Box size={[w,h,.018]} at={[0,h/2,-d/2+.009]} color="#c4ad8a" surface="橡木"/>
    {[0,1,2,3,4,5].map(n=><group key={n}><Box size={[w,.028,d]} at={[0,.03+(h-.06)*n/5,0]} color="#bc9e76" surface="橡木"/>
      {n<5&&[0,1,2,3].map(b=><Box key={b} size={[w*.08,h*.12,d*.65]} at={[-w*.32+b*w*.11,.055+(h-.06)*n/5+h*.06,0]} color={['#e6ded0','#5d6d64','#ad8870','#b9ab8f'][(n+b)%4]}/>)}</group>)}
  </>;
  if (kind === 'wardrobe' || kind === 'bookshelf' || kind === 'console') return <>
    <Box size={[w,h,d]} at={[0,h/2,0]} color={kind==='wardrobe'?'#d5cbb8':'#aa8c65'} surface={kind==='wardrobe'?null:'橡木'}/>
    {kind==='bookshelf' ? [1,2,3,4].map(i=><Box key={i} size={[w+.008,.025,d-.06]} at={[0,h*i/5,.04]} color="#ddc9a4"/>)
      : [-1,1].map(side=><Box key={side} size={[.015,h*.2,.025]} at={[side*w*.15,h*.5,d/2+.02]} color="#73634e"/>)}
  </>;
  if (kind === 'kitchen') return <>
    <Box size={[w,h-.05,d]} at={[0,(h-.05)/2,0]} color="#d7d1c5"/>
    <Box size={[w+.025,.045,d+.02]} at={[0,h,0]} color="#ece9e2" radius={.012}/>
    {Array.from({length:Math.max(2,Math.ceil(w/.5))},(_,i)=><Box key={i} size={[.008,h*.78,.012]}
      at={[-w/2+w*(i+1)/Math.max(2,Math.ceil(w/.5)),h*.47,d/2+.006]} color="#aba89d"/>)}
    <Box size={[w,.5,.3]} at={[0,h+1,-.13]} color="#d6c6ad" surface="橡木"/>
    <Box size={[Math.min(.38,w*.4),.012,.37]} at={[-w*.23,h+.035,0]} color="#333c3b"/>
    {[-1,1].map(side=><mesh key={side} position={[-w*.23+side*w*.08,h+.048,0]} rotation={[-Math.PI/2,0,0]}>
      <ringGeometry args={[.04,.06,24]}/><meshStandardMaterial color="#8d9998" metalness={.7} roughness={.4}/></mesh>)}
    <Box size={[Math.min(.37,w*.37),.028,.32]} at={[w*.24,h+.027,0]} color="#a0acad"/>
    <Box size={[Math.min(.3,w*.3),.026,.25]} at={[w*.24,h+.037,0]} color="#5c7174" radius={.025}/>
    <Faucet at={[w*.24,h+.04,-.18]}/>
  </>;
  if (kind === 'fridge') return <>
    <Box size={[w,h,d]} at={[0,h/2,0]} color="#c7cccb" radius={.025}/>
    <Box size={[w-.025,.012,.018]} at={[0,h*.38,d/2+.01]} color="#6a7777"/>
    <Box size={[.025,h*.25,.035]} at={[-w*.35,h*.67,d/2+.03]} color="#6b7777"/>
  </>;
  if (kind === 'vanity') return <>
    <Box size={[w,h*.72,d]} at={[0,h*.43,0]} color="#b59d7a" surface="橡木"/>
    <Box size={[w+.025,.055,d+.025]} at={[0,h,0]} color="#f2efe5"/>
    <mesh position={[0,h+.055,0]} scale={[w*.43,.10,d*.4]}><sphereGeometry args={[1,32,12,0,Math.PI*2,0,Math.PI/2]}/><meshPhysicalMaterial color="#f0f0e9" roughness={.2}/></mesh>
    <Faucet at={[0,h+.03,-d*.37]}/>
    <mesh position={[0,h+.73,-d/2-.012]}><planeGeometry args={[w*.9,.7]}/><meshStandardMaterial color="#b4c9cf" metalness={1} roughness={.06}/></mesh>
  </>;
  if (kind === 'toilet') return <>
    <Box size={[w*.8,h*.7,.16]} at={[0,h*.64,-d*.35]} color="#e9ece8" radius={.045}/>
    <mesh position={[0,.23,.04]} scale={[w*.5,.23,d*.47]} castShadow receiveShadow><sphereGeometry args={[1,24,16]}/><meshPhysicalMaterial color="#f1f1ec" roughness={.18}/></mesh>
    <mesh position={[0,.45,.045]} rotation={[-Math.PI/2,0,0]} scale={[1,1.35,1]} castShadow><torusGeometry args={[w*.36,.024,10,32]}/><meshStandardMaterial color="#e9ece5" roughness={.24}/></mesh>
  </>;
  if (kind === 'shower') return <>
    <Box size={[w,.035,d]} at={[0,.025,0]} color="#b8bfbd"/>
    <group userData={{excludeFromAO:true}}>
      <mesh position={[w/2,h/2,0]} rotation={[0,Math.PI/2,0]}><planeGeometry args={[d,h]}/><meshPhysicalMaterial color="#e5f1ed" transmission={.9} roughness={.08} thickness={.006} side={THREE.DoubleSide}/></mesh>
      <mesh position={[0,h/2,-d/2]}><planeGeometry args={[w,h]}/><meshPhysicalMaterial color="#e5f1ed" transmission={.9} roughness={.08} thickness={.006} side={THREE.DoubleSide}/></mesh>
    </group>
    <Box size={[.02,h,.02]} at={[w/2,h/2,-d/2]} color="#667374"/>
    <Box size={[.025,1.4,.025]} at={[-w*.35,1.2,d*.42]} color="#8d9998"/>
    <Box size={[.18,.018,.18]} at={[-w*.35,1.96,d*.28]} color="#667878"/>
  </>;
  if (kind === 'desk' || kind === 'dining') return <>
    <Box size={[w,.045,d]} at={[0,h,0]} color="#c7b08e" surface="橡木" radius={.02}/>
    {[-1,1].flatMap(a=>[-1,1].map(b=><Box key={a+':'+b} size={[.045,h-.04,.045]} at={[a*(w/2-.08),(h-.04)/2,b*(d/2-.08)]} color="#73634e"/>))}
    <Chair at={[0,0,d/2+.25]} />
    {kind==='dining' && <Chair at={[0,0,-d/2-.25]} rotation={Math.PI}/>}
  </>;
  return null;
}

export default function RoomFurniture({ items }) {
  return <group>{items.map(item=><group key={item.id} position={[item.x,0,item.z]}><ProceduralItem item={item}/></group>)}</group>;
}
