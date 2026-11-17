import { publicAsset } from './deployment';
import React,{Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useGLTF,RoundedBox,Edges,useProgress,TransformControls} from '@react-three/drei';
import * as THREE from 'three';
import {assets,changeItem} from './furnishing';
import Rug from './Rug';
import ProductMesh from './ProductMesh';
import {ProceduralItem} from './RoomFurniture';
import {transformItems,sourceModelSignature} from './buildTools';

class AssetBoundary extends React.Component{
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){this.props.onError?.(this.props.name);}
  componentDidUpdate(previous){if(previous.assetId!==this.props.assetId&&this.state.error)this.setState({error:false});}
  render(){return this.state.error?<mesh position={[0,.15,0]}><boxGeometry args={[.3,.3,.3]}/><meshBasicMaterial color="#c45e52" wireframe/></mesh>:this.props.children;}
}
function Model({item,asset}){
  const {scene}=useGLTF(asset.url.startsWith('/models/') ? publicAsset(asset.url) : asset.url);
  const model=useMemo(()=>{
    const root=scene.clone(true);
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(item.color){const tint=m=>{const result=m.clone();result.color?.lerp(new THREE.Color(item.color),.45);return result;};o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);}}});
    const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    return {root,size,offset:[-center.x,-box.min.y,-center.z]};
  },[scene,item.color]);
  useEffect(()=>()=>{if(item.color)model.root.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});},[model,item.color]);
  return <group scale={[item.width/model.size.x,item.height/model.size.y,item.depth/model.size.z]}><primitive object={model.root} position={model.offset}/></group>;
}
function TintedProcedural({item,asset}){
  const group=useRef(null),originals=useRef(new WeakMap());
  useEffect(()=>{group.current?.traverse(o=>{if(o.isMesh){for(const mat of Array.isArray(o.material)?o.material:[o.material]){if(!mat.color)continue;if(!originals.current.has(mat))originals.current.set(mat,mat.color.clone());mat.color.copy(originals.current.get(mat));if(item.color)mat.color.lerp(new THREE.Color(item.color),.5);}}});},[item.color,item.assetId]);
  return <group ref={group}><ProceduralItem item={{...item,kind:asset.kind}}/></group>;
}
function Parametric({item,asset}){
  const {width:w,depth:d,height:h}=item,color=item.color||asset.color;
  if(asset.id==='rug')return <Rug width={w} depth={d} height={h} color={item.color||'#c9b79a'} />;
  if(asset.id==='art')return <group position={[0,h/2,0]}>
    <RoundedBox args={[w,h,d]} radius={.008}><meshStandardMaterial color={color} roughness={.5}/></RoundedBox>
    <mesh position={[0,0,d/2+.002]}><planeGeometry args={[w*.9,h*.92]}/><meshStandardMaterial color="#ebe3d2" roughness={.9}/></mesh>
    <mesh position={[-w*.12,h*.07,d/2+.004]}><circleGeometry args={[Math.min(w,h)*.23,48]}/><meshStandardMaterial color={item.color||'#977b58'} roughness={.9}/></mesh>
    <mesh position={[w*.15,-h*.17,d/2+.005]}><planeGeometry args={[w*.32,h*.26]}/><meshStandardMaterial color="#3e4f44" roughness={.9}/></mesh>
  </group>;
  if(asset.id==='floor-lamp')return <group>
    <mesh position={[0,.02,0]} castShadow><cylinderGeometry args={[w*.42,w*.48,.04,40]}/><meshStandardMaterial color="#49483e" metalness={.6} roughness={.3}/></mesh>
    <mesh position={[0,h*.46,0]} castShadow><cylinderGeometry args={[.012,.014,h*.9,20]}/><meshStandardMaterial color="#8c754e" metalness={.8} roughness={.3}/></mesh>
    <mesh position={[0,h*.89,0]} castShadow><cylinderGeometry args={[w*.32,w*.5,h*.2,48,1,true]}/><meshStandardMaterial color={item.color||'#e2d0ad'} roughness={.8} side={THREE.DoubleSide}/></mesh>
    <pointLight position={[0,h*.85,0]} color="#ffe0a8" intensity={12} distance={3}/>
  </group>;
  return <TintedProcedural item={item} asset={asset}/>;
}
function Instance({item,items,onSelect,onChange,selected,orbit,onError,onPreview,tool,walk,register,bakeModel,preferOriginal}){
  const [draft,setDraft]=useState(null),drag=useRef(null),moved=useRef(false);
  const plane=useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0),-item.elevation),[item.elevation]);
  const hit=useMemo(()=>new THREE.Vector3(),[]),asset=assets[item.assetId];
  useEffect(()=>()=>{if(drag.current&&orbit.current)orbit.current.enabled=true;},[orbit]);
  const setRef=useCallback(node=>register(item.id,node),[register,item.id]);
  const down=e=>{e.stopPropagation();onSelect(item.id);if(item.locked||tool!=='drag'||walk)return;if(!e.ray.intersectPlane(plane,hit))return;
    drag.current={px:hit.x,pz:hit.z,x:item.x,z:item.z,next:null};moved.current=false;if(orbit.current)orbit.current.enabled=false;e.target.setPointerCapture?.(e.pointerId);};
  const move=e=>{if(!drag.current)return;e.stopPropagation();if(!e.ray.intersectPlane(plane,hit))return;
    const p=drag.current;const next={x:p.x+hit.x-p.px,z:p.z+hit.z-p.pz};p.next=next;
    if(Math.abs(next.x-p.x)+Math.abs(next.z-p.z)>.02)moved.current=true;setDraft(next);onPreview(changeItem(items,item.id,next));};
  const up=(e,cancel=false)=>{if(!drag.current)return;e.stopPropagation();const p=drag.current;drag.current=null;e.target.releasePointerCapture?.(e.pointerId);if(orbit.current)orbit.current.enabled=true;setDraft(null);onPreview(null);
    if(!cancel&&moved.current&&p.next)onChange(changeItem(items,item.id,p.next));};
  if(!asset)return null;
  const candidate=item.bakedModel||bakeModel,baked=!preferOriginal&&candidate?.signature===sourceModelSignature(item)?candidate:null;
  return <group ref={setRef} name={'RV_ITEM__'+item.id} userData={{rvRole:'item',rvItemId:item.id,rvReconstruction:item.productModel?.type==='image_reconstruction'}} position={[draft?.x??item.x,item.elevation,draft?.z??item.z]} rotation={[0,item.rotation*Math.PI/180,0]}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={e=>up(e,true)} onClick={e=>{e.stopPropagation();if(!moved.current)onSelect(item.id);}}>
    <AssetBoundary name={item.name} assetId={item.assetId+':'+(item.productModel?.url||item.productModel?.id||'')} onError={onError}>
      <Suspense fallback={<mesh userData={{loadingPlaceholder:true}} position={[0,item.height/2,0]}><boxGeometry args={[item.width,item.height,item.depth]}/><meshBasicMaterial color="#bfc8bf" wireframe/></mesh>}>
        {baked?<Model item={{...item,color:undefined}} asset={{url:baked.url}}/>:['source_model','reference_model'].includes(item.productModel?.type)?<Model item={{...item,color:undefined}} asset={{url:item.productModel.url}}/>:item.productModel?.type==='image_reconstruction'?<ProductMesh item={item} geometry={item.productModel.geometry}/>:asset.url?<Model item={item} asset={asset}/>:<Parametric item={item} asset={asset}/>}
      </Suspense>
    </AssetBoundary>
    {selected&&<group userData={{editorOnly:true,excludeFromAO:true}}><mesh position={[0,item.height/2,0]} raycast={()=>null}>
      <boxGeometry args={[item.width+.018,item.height+.018,item.depth+.018]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/><Edges color="#34744d" raycast={()=>null}/>
    </mesh></group>}
  </group>;
}
export default function FurnitureScene({data,target,onSelect,onChange,orbit,onError,tool='drag',snap=0,walk=false,onInvalid,preferOriginal=false}){
  const [preview,setPreview]=useState(null),[object,setObject]=useState(null),objects=useRef(new Map()),pending=useRef(null);
  const register=useCallback((id,node)=>{if(node)objects.current.set(id,node);else objects.current.delete(id);if(id===target)setObject(node);},[target]);
  useEffect(()=>{setObject(objects.current.get(target)||null);setPreview(null);pending.current=null;},[target]);
  const item=data.items?.find(i=>i.id===target);
  const patch=()=>({x:object.position.x,z:object.position.z,elevation:object.position.y,rotation:object.rotation.y*180/Math.PI});
  const change=()=>{if(!object||!item)return;try{const p=patch(),items=transformItems(data,target,p,snap);pending.current=items;setPreview(items);}catch(e){pending.current=null;object.position.set(item.x,item.elevation,item.z);object.rotation.set(0,item.rotation*Math.PI/180,0);onInvalid?.(e.message);}};
  return <group>{(preview||data.items||[]).map(item=><Instance key={item.id} item={item} items={data.items} onSelect={onSelect} onChange={onChange} selected={target===item.id} orbit={orbit} onError={onError} onPreview={setPreview} tool={tool} walk={walk} register={register} bakeModel={data.bake?.assets?.[item.id]} preferOriginal={preferOriginal}/>)}
   {object&&item&&!item.locked&&tool!=='drag'&&!walk&&<TransformControls object={object} mode={tool==='rotate'?'rotate':'translate'} space="world" showX={tool!=='rotate'} showY showZ={tool!=='rotate'} translationSnap={snap||null} rotationSnap={Math.PI/12} size={.8} onMouseDown={()=>{pending.current=null;if(orbit.current)orbit.current.enabled=false;}} onObjectChange={change} onMouseUp={()=>{const next=pending.current;pending.current=null;setPreview(null);if(orbit.current)orbit.current.enabled=true;if(next)onChange(next);}} userData={{editorOnly:true}}/>}
  </group>;
}

export function FurnitureLoading(){const {active,loaded,total}=useProgress();return active?<span className="status-chip">正在加载家具与贴图 {loaded} / {total}</span>:null;}
