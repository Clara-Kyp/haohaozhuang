import { isShowcase } from './deployment';
import React,{useState} from 'react';
import ProductImport from './ProductImport';
import {keepInShelf} from './shelfTools';
import {transformItems} from './buildTools';
import {assets,catalog,changeItem,removeItem,newItem} from './furnishing';
function Field({label,value,onChange,step=.01,min=-60,max=60,disabled}){return <label>{label}<input aria-label={label} type="number" value={value} step={step} min={min} max={max} disabled={disabled} onChange={e=>{if(e.target.value!==''&&e.target.validity.valid)onChange(e.target.valueAsNumber);}}/></label>;}
export default function FurnitureInspector({scene,target,onSelect,onItems,onPlan,onMessage}){
  const item=scene.items?.find(i=>i.id===target),asset=assets[item?.assetId];
  const [adding,setAdding]=useState('armchair');
  const allowed=catalog.filter(a=>scene.roomType==='other'||a.rooms.includes(scene.roomType));
  const update=patch=>{try{onItems(transformItems(scene,item.id,patch));}catch(e){onMessage(e.message);}};
  return <section className="card furniture-inspector">
    <div className="card-title"><h2>{item?'编辑 · '+item.name:'房间陈设'}</h2><span className="badge">{scene.items?.length||0} 件</span></div>
    {item&&<div className="stack" key={item.id}>
      <p className="card-sub">{item.reason}</p>
      <div className="field-pair"><Field label="横向位置 X（米）" value={item.x} onChange={x=>update({x})} disabled={item.locked}/><Field label="纵向位置 Z（米）" value={item.z} onChange={z=>update({z})} disabled={item.locked}/></div>
      <Field label="离地高度 Y（米）" value={item.elevation} min={0} max={Math.max(0,scene.height-item.height)} disabled={item.locked} onChange={elevation=>update({elevation})}/>
      <div className="row"><button disabled={item.locked} onClick={()=>update({elevation:Math.min(scene.height-item.height,item.elevation+.1)})}>上移10cm</button><button disabled={item.locked} onClick={()=>update({elevation:Math.max(0,item.elevation-.1)})}>下移10cm</button></div>
      {item.parentId&&<button disabled={item.locked} onClick={()=>update({parentId:null,freePlacement:true})}>解除支撑，自由摆放</button>}
      <Field label="旋转角度（度）" value={item.rotation} step={1} min={-360} max={360} onChange={rotation=>update({rotation})} disabled={item.locked}/>
      <div className="row"><button disabled={item.locked} onClick={()=>update({rotation:(item.rotation+90)%360})}>旋转90°</button><button onClick={()=>update({locked:!item.locked})}>{item.locked?'解锁物件':'锁定物件'}</button></div>
      <div className="field-triple">{[['宽','width'],['深','depth'],['高','height']].map(([label,k])=><Field key={k} label={label+'（米）'} min={.01} max={8} value={item[k]} onChange={v=>update({[k]:v})} disabled={item.locked}/>)}</div>
      <label>材质调色<input type="color" aria-label="物件颜色" value={item.color||asset.color} disabled={item.locked} onChange={e=>update({color:e.target.value})}/></label>
      <label>替换同类模型<select aria-label="替换同类模型" value={item.assetId} disabled={item.locked} onChange={e=>{const a=assets[e.target.value];update({assetId:a.id,name:a.name,...a.dimensions,color:undefined,productModel:null,...(item.product?{product:{...item.product,modelRelation:'similar'}}:{})});}}>
        {allowed.filter(a=>a.category===asset.category&&a.placement===asset.placement).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>
      <p className="asset-source">{item.productModel?<>{item.productModel.type==='source_model'?'商品页提供的模型 · 款式待核对':'商品图近似重建 · 非厂家同款模型'}{item.productUrl&&<> · <a href={item.productUrl} target="_blank" rel="noreferrer">商品来源</a></>}</>:<>{asset.url?'PBR模型':'参数模型'} · {asset.license}{asset.source?.startsWith('https://')&&<> · <a href={asset.source} target="_blank" rel="noreferrer">素材出处</a></>}</>}</p>
      {!isShowcase && <ProductImport key={item.id} item={item} scene={scene} onItems={onItems} onMessage={onMessage}/> }
      <button disabled={item.locked} onClick={()=>{try{const remaining=removeItem(scene.items,item.id),moved=scene.items.filter(i=>!remaining.some(r=>r.id===i.id));moved.forEach(keepInShelf);if(onItems(remaining)===false)return;onSelect(null);onMessage(`已将${moved.length}件物品放回储物栏，商品资料和原模型已保留。`);}catch(e){onMessage(e.message);}}}>放回储物栏{scene.items.some(i=>i.parentId===item.id)?'（含台面配饰）':''}</button>
    </div>}
    <div className="furniture-object-list" aria-label="房间物件清单">{(scene.items||[]).map((i,n)=><button key={i.id} aria-pressed={target===i.id} onClick={()=>{onSelect(i.id);}}><span>{String(n+1).padStart(2,'0')}</span><strong>{i.name}</strong><small>{i.locked?'已锁定':i.parentId?'台面配饰':`${Math.round(i.width*100)} × ${Math.round(i.depth*100)} cm`}</small></button>)}</div>
    <div className="stack"><label>添加家具或配饰<select aria-label="添加家具或配饰" value={allowed.some(a=>a.id===adding)?adding:allowed[0]?.id||''} onChange={e=>setAdding(e.target.value)}>{allowed.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <button onClick={()=>{const id=allowed.some(a=>a.id===adding)?adding:allowed[0]?.id;const next=newItem(id,scene,item?.id);if(!next){onMessage('没有合适的空位或支撑台面，请先调整现有家具。');return;}onItems([...scene.items,next]);onSelect(next.id);}}>添加到房间</button>
    <button className="pill" onClick={onPlan}>返回陈设提案</button></div>
  </section>;
}
