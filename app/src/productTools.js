import {assets,changeItem,newItem,furnishingWarning} from './furnishing.js';
export function placementDimensions(record,dimensions={}){
 const v=record?.variants?.find(v=>v.id===record.selectedVariantId),dims={...dimensions,...v?.dimensions};
 if(record?.assetId==='rug'&&!Number.isFinite(dims.height))dims.height=assets.rug.dimensions.height;
 return dims;
}
export function preferredModel(record){
  const models=record?.models||[];
  return (models.find(m=>m.canApply!==false&&m.type==='source_model')||models.find(m=>m.canApply!==false&&m.type==='reference_model')||models.find(m=>m.canApply!==false&&m.type==='similar'&&m.assetId===record?.assetId))?.id||'';
}
export function applyProductToItems(scene,targetId,record,modelId,dimensions,color){
  const target=scene.items.find(i=>i.id===targetId);
  if(!target||target.locked)throw new Error('请先选中并解锁要替换的物件。');
  const model=record.models?.find(m=>m.id===modelId),variant=record.variants?.find(v=>v.id===record.selectedVariantId);
  if(!model||!variant||!record.images?.length)throw new Error('商品款式、图片或模型未读取完整。');
  if(model.canApply===false)throw new Error('模型仍有造型差异，请先核对并细化，不会用草模替换。');
  if(!['width','depth','height'].every(k=>Number.isFinite(dimensions[k])&&dimensions[k]>=.01&&dimensions[k]<=8))throw new Error('请核对并填写完整的商品宽、深、高（米）。');
  const assetId=model.type==='similar'?model.assetId:record.assetId,asset=assets[assetId];
  if(!asset)throw new Error('此商品尚无可用于当前编辑器的模型类型。');
  if(['source_model','reference_model'].includes(model.type)&&!/^\/api\/products\/media\/[0-9a-f]{64}\.glb$/.test(model.url))throw new Error('商品模型来源未通过验证。');
  const children=scene.items.filter(i=>i.parentId===targetId);
  if(children.length&&!['桌几','柜架'].includes(asset.category))throw new Error('此物件有台面配饰，请先移开配饰，再替换为其他品类。');
  const dimensionEvidence=Object.fromEntries(['width','depth','height'].map(k=>[k,dimensions[k]===variant.dimensions?.[k]?variant.dimensionEvidence?.[k]:'用户核对后填写：'+dimensions[k]+' m']));
  if(asset.placement==='rug'&&!variant.dimensions?.height&&dimensions.height===assets.rug.dimensions.height)dimensionEvidence.height='场景示意厚度：1.2 cm，商家未提供实际厚度。';
  const product={importId:record.id,title:record.title,variantId:variant.id,variantName:variant.name,colorName:variant.color,style:variant.style,images:record.images,dimensions:{...dimensions},dimensionEvidence,sourceUrl:record.sourceUrl,resolvedUrl:record.resolvedUrl,fetchedAt:record.fetchedAt,confirmedAt:new Date().toISOString(),modelRelation:model.type,modelId:model.id,snapshot:record};
  const patch={assetId,name:record.title||variant.name,...dimensions,color:color||record.color||undefined,productUrl:record.sourceUrl,product,bakedModel:null,productModel:model.type==='similar'?null:{...model,basedOnImage:record.images[0].url}};
  if(asset.placement==='floor'||asset.placement==='rug'){patch.parentId=null;patch.elevation=target.freePlacement&&assets[target.assetId]?.placement===asset.placement?target.elevation:asset.placement==='rug'?.008:0;}
  else if(asset.placement==='surface'&&!target.parentId&&!target.freePlacement){
    const seed=newItem(assetId,{...scene,items:scene.items.filter(i=>i.id!==targetId)});
    if(!seed)throw new Error('此商品需要台面支撑，请先添加合适的桌柜。');
    Object.assign(patch,{parentId:seed.parentId,x:seed.x,z:seed.z,elevation:seed.elevation});
  }
  const items=changeItem(scene.items,targetId,patch),error=furnishingWarning(items,scene);
  if(error)throw new Error('商品规格与当前摆位冲突：'+error+' 原物件已保留。');
  return items;
}
