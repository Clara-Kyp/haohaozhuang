import React,{useEffect,useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {useGLTF} from '@react-three/drei';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {sceneSignature,sourceModelSignature,roomSignature} from './buildTools';
function exportClone(node){
 const clone=node.clone(true),remove=[];
 clone.traverse(o=>{if(o.userData.editorOnly||o.userData.excludeFromExport||o.isLight||o.isCamera)remove.push(o);if(o.userData.loadingPlaceholder)throw new Error('家具模型仍在加载，请加载完成后再烘焙。');});
 for(const o of remove)o.removeFromParent();return clone;
}
export default function SceneBridge({bridge,data}){
 const {scene,camera,gl}=useThree();
 useEffect(()=>{if(!bridge)return;
  bridge.current={project(clientX,clientY){const r=gl.domElement.getBoundingClientRect(),ndc=new THREE.Vector2((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);const hit=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),hit)?{x:hit.x,z:hit.z}:null;},async export(){
   const root=new THREE.Group();root.name='RoomvoiceBakeSource';
   const room=scene.getObjectByName('RV_ROOM');if(!room)throw new Error('房间外壳未准备好。');root.add(exportClone(room));
   for(const item of data.items||[]){const obj=scene.getObjectByName('RV_ITEM__'+item.id);if(!obj)throw new Error(item.name+'的模型尚未加载。');root.add(exportClone(obj));}
   root.updateMatrixWorld(true);
   const binary=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false,trs:true,includeCustomExtensions:true});
   return {binary,manifest:{version:1,sourceSignature:sceneSignature(data),roomSignature:roomSignature(data),scene:{width:data.width,depth:data.depth,height:data.height,faces:data.faces,ceiling:data.ceiling},items:(data.items||[]).map(i=>({id:i.id,name:i.name,width:i.width,depth:i.depth,height:i.height,x:i.x,z:i.z,elevation:i.elevation,rotation:i.rotation,signature:sourceModelSignature(i),inventoryId:i.inventoryId,sourceUrl:i.product?.sourceUrl,reconstruction:i.productModel?.type==='image_reconstruction'}))}};
  }};return()=>{bridge.current=null;};
 },[scene,camera,gl,bridge,data]);return null;
}
export function BakedShell({url,onSelect,width,depth,height,full=false}){
 const {scene}=useGLTF(url),model=useMemo(()=>scene.clone(true),[scene]);
 const receiver=useMemo(()=>{const clone=scene.clone(true);clone.traverse(o=>{if(o.isMesh){const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.some(m=>!m.emissiveMap||m.transparent||m.transmission>.4)){o.visible=false;return;}o.material=new THREE.ShadowMaterial({opacity:.35,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});o.castShadow=false;o.receiveShadow=true;o.renderOrder=2;}});return clone;},[scene]);
 useEffect(()=>()=>receiver.traverse(o=>{if(o.isMesh&&o.material.isShadowMaterial)o.material.dispose();}),[receiver]);
 const selectFace=e=>{e.stopPropagation();const p=e.point;if(p.y<.15)onSelect('floor');else if(p.y>height-.15)onSelect('ceiling');else{const faces=[['west',Math.abs(p.x+width/2)],['east',Math.abs(p.x-width/2)],['north',Math.abs(p.z+depth/2)],['south',Math.abs(p.z-depth/2)]];faces.sort((a,b)=>a[1]-b[1]);onSelect(faces[0][0]);}};
 return <group onClick={selectFace}><primitive object={model}/>{!full&&<primitive object={receiver}/>}</group>;
}
