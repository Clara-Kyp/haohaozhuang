import { publicAsset } from './deployment';
import React,{useEffect,useMemo} from 'react';
import * as THREE from 'three';
const textureCache=new Map();
function texture(url){if(!textureCache.has(url)){const value=new THREE.TextureLoader().load(url);value.wrapS=value.wrapT=THREE.RepeatWrapping;textureCache.set(url,value);}return textureCache.get(url);}
/** 商品图驱动的结构重建，按实际规格归一化；不是照片贴在方盒上的假模型。 */
export default function ProductMesh({item,geometry}){
  const model=useMemo(()=>{
    const root=new THREE.Group(),materials=new Map();
    for(const part of geometry.parts||[]){
      const appliedColor=item.color&&['fabric','paint'].includes(part.material)?new THREE.Color(part.color).lerp(new THREE.Color(item.color),.55).getHexString():null;
      const key=part.material+part.color+(appliedColor||'');let material=materials.get(key);
      if(!material){
        const common={color:appliedColor?'#'+appliedColor:part.color,roughness:part.material==='fabric'?.93:part.material==='wood'?.55:.4,metalness:part.material==='metal'?.85:0};
        if(part.material==='fabric'){common.normalMap=texture(publicAsset('/textures/fabric_pattern_07_nor_gl_1k.jpg'));common.normalScale=new THREE.Vector2(.28,.28);}
        if(part.material==='wood'){common.normalMap=texture(publicAsset('/textures/oak_veneer_01_nor_gl_1k.jpg'));common.normalScale=new THREE.Vector2(.35,.35);}
        material=part.material==='glass'?new THREE.MeshPhysicalMaterial({...common,roughness:.12,transmission:.8,thickness:.015,ior:1.5}):new THREE.MeshStandardMaterial(common);
        material.name='rv-'+part.material;
        materials.set(key,material);
      }
      let mesh;
      if(part.type==='rod'){
        const from=new THREE.Vector3(...part.start),to=new THREE.Vector3(...part.end),direction=to.clone().sub(from);
        mesh=new THREE.Mesh(new THREE.CylinderGeometry(part.radius,part.radius,Math.max(.001,direction.length()),24),material);mesh.position.copy(from.clone().add(to).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
      }else{
        const size=part.size;
        if(part.type==='box')mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);
        else if(part.type==='sphere'){mesh=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),material);mesh.scale.set(size[0]/2,size[1]/2,size[2]/2);}
        else if(part.type==='cylinder')mesh=new THREE.Mesh(new THREE.CylinderGeometry(size[0],size[1],size[2],48),material);
        if(!mesh)continue;mesh.position.set(...part.position);mesh.rotation.set(...part.rotation.map(a=>a*Math.PI/180));
      }
      mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
    }
    const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    return {root,size,offset:[-center.x,-box.min.y,-center.z],materials};
  },[geometry,item.color]);
  useEffect(()=>()=>{model.root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});for(const material of model.materials.values())material.dispose();},[model]);
  return <group scale={[item.width/Math.max(.001,model.size.x),item.height/Math.max(.001,model.size.y),item.depth/Math.max(.001,model.size.z)]}>
    <primitive object={model.root} position={model.offset}/>
  </group>;
}
