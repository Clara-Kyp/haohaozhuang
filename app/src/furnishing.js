import catalog from './furnitureCatalog.json' with {type:'json'};
export {catalog};
export const assets=Object.fromEntries(catalog.map(a=>[a.id,a]));
export const freshFurnishing=(style='奶油风')=>({style,instruction:'先保证动线与日常使用，再完整搭配主家具、收纳、灯具、地毯、挂画、绿植和桌面配饰。精致但不要堆满。',references:[],proposal:null,error:''});
export function extent(item){const a=item.rotation*Math.PI/180;return [(Math.abs(Math.cos(a))*item.width+Math.abs(Math.sin(a))*item.depth)/2,(Math.abs(Math.sin(a))*item.width+Math.abs(Math.cos(a))*item.depth)/2];}
function collide(a,b){
  const axes=[a,b].flatMap(o=>{const r=o.rotation*Math.PI/180;return [[Math.cos(r),-Math.sin(r)],[Math.sin(r),Math.cos(r)]];});
  const radius=(i,[x,z])=>{const r=i.rotation*Math.PI/180;return Math.abs(x*Math.cos(r)-z*Math.sin(r))*i.width/2+Math.abs(x*Math.sin(r)+z*Math.cos(r))*i.depth/2;};
  return axes.every(([x,z])=>Math.abs((a.x-b.x)*x+(a.z-b.z)*z)<radius(a,[x,z])+radius(b,[x,z])-.025);
}
export function furnishingWarning(items,scene){
  if(!Array.isArray(items)||items.length>40)return '陈设清单无效。';
  const ids=new Set();
  for(const i of items){
    const a=assets[i.assetId];
    if(!a||!i.id||ids.has(i.id))return '家具编号或模型无效。';ids.add(i.id);
    if(!['x','z','rotation','elevation','width','depth','height'].every(k=>Number.isFinite(i[k])))return '家具位置和尺寸须为有效数字。';
    if(!['width','depth','height'].every(k=>i[k]>=.01&&i[k]<=8))return '家具尺寸无效。';
    const [ex,ez]=extent(i);
    if(Math.abs(i.x)+ex>scene.width/2+.015||Math.abs(i.z)+ez>scene.depth/2+.015||i.elevation<0||i.elevation+i.height>scene.height+.01)return `${i.name}超出房间边界。`;
    if(a.placement==='wall' && i.z-ez < -scene.depth/2+.1 && Math.abs(i.x)-ex < scene.width*.31 && i.elevation+i.height>scene.height*.25 && i.elevation<scene.height*.85)return `${i.name}遮挡示意窗洞，请移到窗侧或其他墙面。`;
    if(a.placement==='floor'&&((i.elevation>.01&&!i.freePlacement)||i.parentId))return `${i.name}需要落地放置。`;
    if(a.placement==='floor'&&i.x+ex>scene.width/2-.9&&i.z+ez>scene.depth/2-.85)return `${i.name}占用示意入口，请移开。`;
    if(a.placement==='surface'&&!i.parentId&&!i.freePlacement)return `${i.name}需要支撑家具。`;
    if(i.parentId){
      const p=items.find(v=>v.id===i.parentId);if(!p||p.parentId||!['桌几','柜架'].includes(assets[p.assetId]?.category))return '配饰支撑家具无效。';
      const r=p.rotation*Math.PI/180,dx=i.x-p.x,dz=i.z-p.z;
      const [sx,sz]=extent({...i,rotation:i.rotation-p.rotation});
      if(Math.abs(dx*Math.cos(r)-dz*Math.sin(r))+sx>p.width/2+.025||Math.abs(dx*Math.sin(r)+dz*Math.cos(r))+sz>p.depth/2+.025)return `${i.name}需要放在支撑家具台面内。`;
      if(Math.abs(i.elevation-p.elevation-p.height-.008)>.02)return `${i.name}离开了支撑台面。`;
    }
  }
  const solid=items.filter(i=>assets[i.assetId].placement==='floor'||(assets[i.assetId].placement==='surface'&&i.freePlacement));
  for(let n=0;n<solid.length;n++)for(const two of solid.slice(n+1))if(solid[n].elevation<two.elevation+two.height-.02&&two.elevation<solid[n].elevation+solid[n].height-.02&&collide(solid[n],two))return `${solid[n].name}与${two.name}重叠，请调整位置。`;
  return '';
}
export function changeItem(items,id,patch){
  const old=items.find(i=>i.id===id);if(!old||old.locked&&patch.locked!==false)return items;
  const next={...old,...patch},angle=(next.rotation-old.rotation)*Math.PI/180;
  return items.map(i=>{
    if(i.id===id)return next;
    if(i.parentId!==id)return i;
    const dx=i.x-old.x,dz=i.z-old.z;
    return {...i,x:next.x+dx*Math.cos(angle)+dz*Math.sin(angle),z:next.z-dx*Math.sin(angle)+dz*Math.cos(angle),rotation:i.rotation+next.rotation-old.rotation,elevation:next.elevation+next.height+.008};
  });
}
export const removeItem=(items,id)=>items.filter(i=>i.id!==id&&i.parentId!==id);
export function newItem(assetId,scene,parentId,free=false){
  const asset=assets[assetId];if(!asset)return null;
  const base={id:'item-'+crypto.randomUUID().slice(0,8),assetId,name:asset.name,...asset.dimensions,x:0,z:0,rotation:0,elevation:asset.placement==='wall'?1.2:asset.placement==='rug'?.008:0,parentId:null,locked:false,reason:'用户手动添加。'};
  if(asset.placement==='rug'){
    base.width=Math.min(base.width,scene.width-.2);base.depth=Math.min(base.depth,scene.depth-.2);
    if(base.width<.3||base.depth<.3)return null;
    const anchor=scene.items.find(i=>i.assetId==='coffee')||scene.items.find(i=>['sofa','antique-sofa'].includes(i.assetId));
    const front=anchor&&assets[anchor.assetId]?.category==='座椅'?(anchor.depth+base.depth)*.35:0,r=(anchor?.rotation||0)*Math.PI/180;
    const x=(anchor?.x||0)+Math.sin(r)*front,z=(anchor?.z||0)+Math.cos(r)*front;
    const item={...base,x:Math.max(-scene.width/2+base.width/2+.05,Math.min(scene.width/2-base.width/2-.05,x)),z:Math.max(-scene.depth/2+base.depth/2+.05,Math.min(scene.depth/2-base.depth/2-.05,z))};
    if(!furnishingWarning([...(scene.items||[]),item],scene))return item;
  }
  const host=asset.placement==='surface'?(scene.items.find(i=>i.id===parentId&&['桌几','柜架'].includes(assets[i.assetId]?.category))||scene.items.find(i=>['桌几','柜架'].includes(assets[i.assetId]?.category))):null;
  if(asset.placement==='surface'&&!host){if(!free)return null;base.freePlacement=true;}
  if(host)return {...base,x:host.x,z:host.z,parentId:host.id,elevation:host.elevation+host.height+.008};
  if(asset.placement==='wall')return {...base,x:-scene.width/2+.035,rotation:90};
  for(let z=-scene.depth/2+base.depth/2+.1;z<scene.depth/2;z+=.2)for(let x=-scene.width/2+base.width/2+.1;x<scene.width/2;x+=.2){
    const item={...base,x,z};if(!furnishingWarning([...(scene.items||[]),item],scene))return item;
  }
  return null;
}
export function requireFurnishing(value,scene){
  if(value?.source!=='model'||!value.items?.length||!value.summary)throw new Error('未收到完整的模型陈设提案，原场景已保留。');
  const error=furnishingWarning(value.items,scene);if(error)throw new Error(error);
  return value;
}
export function describePosition(i){return `X ${i.x.toFixed(2)} / Z ${i.z.toFixed(2)} m · 转角 ${i.rotation}°`+(i.parentId?' · 台面配饰':'');}
