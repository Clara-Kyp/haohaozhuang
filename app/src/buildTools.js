import {assets,newItem,changeItem,furnishingWarning} from './furnishing.js';
import {applyProductToItems} from './productTools.js';
export const copy=value=>structuredClone(value);
export function roomSignature(scene){return JSON.stringify([scene.width,scene.depth,scene.height,scene.faces,scene.paint,scene.ceiling,scene.drop,scene.band,scene.tileCm,scene.tv]);}
export function sceneSignature(scene){
  return JSON.stringify({width:scene.width,depth:scene.depth,height:scene.height,faces:scene.faces,paint:scene.paint,ceiling:scene.ceiling,drop:scene.drop,band:scene.band,tileCm:scene.tileCm,tv:scene.tv,items:(scene.items||[]).map(({bakedModel,...i})=>i)});
}
export function showroomSnapshot(scene){return copy({...(scene.style ? {style:scene.style} : {}),items:scene.items||[],faces:scene.faces,paint:scene.paint,ceiling:scene.ceiling,drop:scene.drop,band:scene.band,tileCm:scene.tileCm,tv:scene.tv,createdAt:new Date().toISOString()});}
export function restoreShowroom(scene){
  if(!scene.showroom)throw new Error('尚无样板间基准，请先确认陈设方案或保存当前样板间。');
  const {createdAt,...patch}=copy(scene.showroom),error=furnishingWarning(patch.items,{...scene,...patch});
  if(error)throw new Error('样板间与当前房间尺寸不匹配：'+error);
  return {...patch,furnishingApplied:true,buildMode:'showroom'};
}
export function transformItems(scene,id,patch,snap=0){
  const target=scene.items.find(i=>i.id===id);if(!target||target.locked)return scene.items;
  const next={...patch};
  for(const k of ['x','z','elevation'])if(Number.isFinite(next[k])&&snap>0)next[k]=Math.round(next[k]/snap)*snap;
  if(Number.isFinite(next.elevation)&&Math.abs(next.elevation-target.elevation)>.0001){next.freePlacement=next.elevation>.01;next.parentId=null;}
  if(target.bakedModel&&['width','depth','height','color','assetId'].some(k=>k in next&&next[k]!==target[k]))next.bakedModel=null;
  const result=changeItem(scene.items,id,next),error=furnishingWarning(result,scene);if(error)throw new Error(error);return result;
}
export function placeCandidate(scene,entry,position,dimensions,modelId){
  const record=entry.snapshot;
  if(!record||record.status!=='ready')throw new Error('请先提取此商品图片与模型，再核对规格。');
  const seed=newItem(record.assetId,scene,null,true);
  if(!seed)throw new Error('请先为此物件腾出空间或添加支撑家具。');
  const item={...seed,...(position?{x:position.x,z:position.z}:{}),inventoryId:entry.id};
  const result=applyProductToItems({...scene,items:[...scene.items,item]},item.id,record,modelId||record.models?.[0]?.id,dimensions||record.selectedVariant?.dimensions,record.color);
  const baked=entry.bakedModel;
  return result.map(i=>i.id===item.id&&baked?{...i,bakedModel:baked}:i);
}
export function restoreStoredItem(scene,saved){
 const base={...copy(saved),id:'item-'+crypto.randomUUID().slice(0,8),parentId:null,locked:false,bakedModel:null,freePlacement:true};
 const valid=i=>!furnishingWarning([...scene.items,i],scene);
 if(valid(base))return [...scene.items,base];
 for(let z=-scene.depth/2+base.depth/2+.1;z<scene.depth/2;z+=.2)for(let x=-scene.width/2+base.width/2+.1;x<scene.width/2;x+=.2){const candidate={...base,x,z};if(valid(candidate))return [...scene.items,candidate];}
 throw new Error('房间中没有合适的空位，请先调整家具位置。');
}
export function sourceModelSignature(item){return JSON.stringify([item.assetId,item.width,item.depth,item.height,item.color,item.productModel]);}
