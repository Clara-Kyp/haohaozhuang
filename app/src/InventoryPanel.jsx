import { isShowcase } from './deployment';
import React,{useEffect,useId,useRef,useState} from 'react';
import ProductDialog from './ProductDialog';
import {catalog,newItem} from './furnishing';
import {placeCandidate,restoreStoredItem} from './buildTools';
import ProductModelReview from './ProductModelReview';
import {preferredModel,placementDimensions} from './productTools';
import {SHELF_EVENT,productLink,productKey,shelfEntry,readShelf,keepInShelf,updateShelf,resolveShelf,removeFromShelf,mergeShelf,shelfCategory,shelfStatus} from './shelfTools';
const money=e=>e.price!=null&&e.price!==''?`${e.currency||'CNY'} ${e.price}`:'价格未提供';
const reviewText=e=>[e.reviews?.rating!=null?'评分 '+e.reviews.rating:'',e.reviews?.count!=null?e.reviews.count+' 条评价':'',e.reviews?.summary||''].filter(Boolean).join(' · ')||'暂无评论信息';
async function request(path,body){const r=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined),d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'物品库暂不可用');return d;}
function confirmations(){try{return JSON.parse(localStorage.getItem('roomvoice-inventory-confirmed')||'{}');}catch{return {};}}
function AssetArt({asset}){return <div className={'shelf-asset-art '+(asset.id==='rug'?'rug-art':'')} aria-hidden="true">{asset.id==='rug'?<span/>:<span>{asset.category==='灯具'?'◉':asset.category==='配饰'?'♧':'▱'}</span>}<small>{asset.id==='rug'?'织物 · 可调尺寸':asset.category}</small></div>;}
export default function InventoryPanel({scene,onItems,onSelect,onMessage,dropRef,onBakeProduct,open,onToggle,toggleRef}){
 const [data,setData]=useState({groups:[],total:0}),[stored,setStored]=useState(readShelf),[tab,setTab]=useState(isShowcase ? 'assets' : 'products'),[category,setCategory]=useState('全部'),[filter,setFilter]=useState(''),[link,setLink]=useState(''),[selected,setSelected]=useState(null),[dims,setDims]=useState({}),[model,setModel]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const [loading,setLoading]=useState(!isShowcase),[loadError,setLoadError]=useState(''),[linkError,setLinkError]=useState('');
 const [reading,setReading]=useState([]);
 const linkErrorId=useId(),linkRef=useRef(null);
 const fileRef=useRef(null),alive=useRef(true),running=useRef(new Set()),loadingRequest=useRef(null);
 function load(){
  if(isShowcase)return;
  if(loadingRequest.current)return loadingRequest.current;
  setLoading(true);
  setLoadError('');
  loadingRequest.current=request('inventory')
   .then(result=>{if(alive.current)setData(result);})
   .catch(error=>{if(alive.current)setLoadError(error.message);})
   .finally(()=>{loadingRequest.current=null;if(alive.current)setLoading(false);});
  return loadingRequest.current;
 }
 useEffect(()=>{alive.current=true;load();const sync=()=>setStored(readShelf());window.addEventListener(SHELF_EVENT,sync);window.addEventListener('storage',sync);window.addEventListener('roomvoice-inventory-updated',load);return()=>{alive.current=false;window.removeEventListener(SHELF_EVENT,sync);window.removeEventListener('storage',sync);window.removeEventListener('roomvoice-inventory-updated',load);};},[]);
 async function read(entry,retry=false){
  if(running.current.has(entry.id))return;running.current.add(entry.id);setReading(ids=>[...ids,entry.id]);updateShelf(entry.id,{autoPrepared:true,error:''});
  try{const d=await request(retry&&entry.importId?'products/'+entry.importId+'/refresh':'products/import',retry&&entry.importId?{}:{url:entry.sourceUrl,targetAssetId:entry.assetId||'',prepareModel:true});if(alive.current){resolveShelf(entry.id,d);if(d.status==='ready')load();}}catch(e){if(alive.current){updateShelf(entry.id,{status:'error',modelState:'error',error:e.message});setError(e.message);}}finally{running.current.delete(entry.id);if(alive.current)setReading(ids=>ids.filter(id=>id!==entry.id));}
 }
 useEffect(()=>{for(const e of stored.items)if(e.sourceUrl&&(!e.autoPrepared||(e.status==='pending'&&!e.importId)))read(e);},[stored]);
 useEffect(()=>{const pending=stored.items.filter(e=>e.importId&&(e.status==='processing'||e.status==='ready'&&['pending','queued','processing'].includes(e.modelState)));if(!pending.length)return;let stop=false;const timer=setInterval(async()=>{for(const e of pending){try{const d=await request('products/'+e.importId);if(!stop){resolveShelf(e.id,d);if(d.status==='ready'&&!['queued','processing'].includes(d.modelBuild?.status))load();}}catch(err){if(!stop)updateShelf(e.id,{status:'error',modelState:'error',error:err.message});}}},1600);return()=>{stop=true;clearInterval(timer);};},[stored]);
 const all=mergeShelf(data.groups.flatMap(g=>g.candidates),stored),materials=catalog.filter(a=>scene.roomType==='other'||a.rooms.includes(scene.roomType));
 function addAsset(a){try{const item=newItem(a.id,scene);if(!item)throw new Error(a.id==='rug'?'房间放不下这张地毯，请先调整房间尺寸或现有陈设。':'没有合适的空位或支撑台面，请先调整现有家具。');if(onItems([...scene.items,item])!==false){onSelect(item.id);setError('');onMessage(a.id==='rug'?'已铺好地毯。点选后可以拖动、旋转、调整长宽和颜色。':'已放入房间，点选物品即可编辑。');}}catch(e){setError(e.message);onMessage(e.message);}}
 function add(entry,position,spec,chosen){try{const items=placeCandidate(scene,entry,position,spec,chosen);if(onItems(items)===false)return false;onSelect(items.find(i=>!scene.items.some(old=>old.id===i.id))?.id);onMessage('已放入房间，可以拖动、旋转和调整尺寸。');return true;}catch(e){setError(e.message);onMessage(e.message);return false;}}
 function choose(entry,position){
  setError('');if(entry.sceneItem){try{const items=restoreStoredItem(scene,entry.sceneItem);if(onItems(items)!==false){onSelect(items.at(-1).id);onMessage('已从储物栏放回房间，保留原有模型和尺寸。');}}catch(e){setError(e.message);}return;}
  if(entry.status!=='ready'){keepInShelf({...entry,autoPrepared:false});onMessage('已存入储物栏，正在自动读取商品并准备模型。');return;}
  const known=confirmations()[entry.id];if(known?.version===entry.snapshot.analyzedAt&&add(entry,position,known.dimensions,known.model))return;
  const v=entry.snapshot.variants.find(v=>v.id===entry.snapshot.selectedVariantId);setSelected({entry,position});setDims(placementDimensions(entry.snapshot,entry.dimensions));setModel(preferredModel(entry.snapshot));setConfirmed(false);
 }
 useEffect(()=>{if(dropRef)dropRef.current=(id,position)=>{const entry=all.find(e=>e.id===id);if(entry)choose(entry,position);else{const a=materials.find(a=>'asset:'+a.id===id);if(a)addAsset(a);}};return()=>{if(dropRef)dropRef.current=null;};});
 function submit(e){e.preventDefault();setError('');setLinkError('');try{const url=productLink(link),key=productKey(url),existing=all.find(e=>e.id===key||e.sourceUrl&&productKey(e.sourceUrl,e.variantId)===key);if(existing){setFilter(existing.name);onMessage('这个商品已经在储物栏中。');}else{keepInShelf({sourceUrl:url,name:'正在读取商品',status:'pending',autoPrepared:false});setFilter('');onMessage('已添加到储物栏，图片、规格和近似模型会自动准备。');}setLink('');setTab('products');setCategory('全部');}catch(err){setLinkError(err.message);linkRef.current?.focus();}}
 async function upload(file){if(!file)return;setError('');try{if(file.size>5_000_000)throw new Error('表格须小于5MB。');const encoded=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});const result=await request('inventory/import',{name:file.name,data:encoded});setData(result);setTab('products');onMessage(`已导入${result.imported}个商品，存入储物栏后会自动准备模型。`);if(result.warnings?.length)setError(result.warnings.join(' '));}catch(err){setError(err.message);}finally{if(fileRef.current)fileRef.current.value='';}}
 const products=all.filter(e=>(category==='全部'||shelfCategory(e)===category)&&(!filter||[e.name,e.variantName].join(' ').toLowerCase().includes(filter.toLowerCase()))),builtin=materials.filter(a=>(category==='全部'||shelfCategory(a)===category)&&(!filter||a.name.includes(filter)));
 const showBuiltins=tab==='assets'||category==='地毯';
 const resultCount=(tab==='products'?products.length:0)+(showBuiltins?builtin.length:0);
 const resultStatus=tab==='products'&&loading?'正在加载物品库…'
  :tab==='products'&&loadError?''
  :resultCount>0?`显示 ${resultCount} 项`
  :filter||category!=='全部'?'没有找到匹配的物品':'这里还没有物品';
 return <section className="inventory-panel" id="studio-shelf" aria-labelledby="studio-shelf-heading">
  <header>
   <div>
    <h2 id="studio-shelf-heading">储物栏</h2>
    <p>{isShowcase ? '挑选内置素材，或取回暂存的物件。' : '导入喜欢的物品，准备好后直接放入房间。'}</p>
   </div>
   <button className="shelf-toggle" ref={toggleRef} aria-expanded={open} aria-controls="studio-shelf-content" onClick={onToggle}>
    {open?'收起储物栏':'展开储物栏'} <span aria-hidden="true">{open?'▴':'▾'}</span>
   </button>
  </header>
  <div id="studio-shelf-content" hidden={!open}>
   {!isShowcase && <><div className="row shelf-file-actions">
    <a className="btn" href="/api/inventory/template" download="好好装-商品清单模板.xlsx">下载Excel模板</a>
    <button onClick={()=>fileRef.current.click()}>导入Excel清单</button>
    <input hidden ref={fileRef} type="file" accept=".xlsx,.csv" onChange={e=>upload(e.target.files[0])}/>
   </div>
   <form className="shelf-import" onSubmit={submit}><label htmlFor="shelf-link">从商品链接添加</label><div><input id="shelf-link" ref={linkRef} value={link} aria-invalid={linkError?true:undefined} aria-describedby={linkError?linkErrorId:undefined} onChange={e=>{setLink(e.target.value);setLinkError('');}} placeholder="粘贴淘宝 / 天猫商品链接或分享文字"/><button className="btn-primary">添加到储物栏</button></div>{linkError&&<p id={linkErrorId} role="alert" className="notice warn">{linkError}</p>}<small>自动读取图片与规格，并准备近似3D模型；原商品链接会一并保存。</small></form></>}
   <div className="shelf-browse"><div className="row"><button aria-pressed={tab==='products'} onClick={()=>setTab('products')}>我的物品 · {all.length}</button><button aria-pressed={tab==='assets'} onClick={()=>setTab('assets')}>内置素材</button></div><input aria-label="搜索储物栏" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜索名称、款式…"/><button className="shelf-rug-shortcut" onClick={()=>addAsset(catalog.find(a=>a.id==='rug'))}>＋ 铺一张地毯</button></div>
   <div className="shelf-categories" aria-label="物品分类">{['全部','家具','灯具','地毯','配饰'].map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</div>
   {loadError&&<p role="alert" className="notice warn">{loadError}。请点「刷新物品库」重试。</p>}
   <p role="status">{resultStatus}</p>
   {error&&<p role="alert" className="notice warn">{error}</p>}
   <div className="shelf-grid" aria-label="储物栏物品">
    {tab==='products'&&products.map(entry=>{const busy=reading.includes(entry.id)||entry.status==='processing'||['queued','processing'].includes(entry.modelState),ready=entry.sceneItem||entry.status==='ready',placed=scene.items.some(i=>shelfEntry(i).id===entry.id);return <article className="shelf-card" key={entry.id} aria-label={'储物栏物品：'+entry.name} draggable={!!ready} onDragStart={e=>{e.dataTransfer.setData('application/x-roomvoice-product',entry.id);e.dataTransfer.effectAllowed='copy';}}>
     <button className="shelf-thumb" disabled={!ready} onClick={e=>{e.currentTarget.focus();choose(entry);}} aria-label={'放入 '+entry.name}>{entry.image?<img src={entry.image} alt={entry.name}/>:<span>{entry.sceneItem?'已保存模型':entry.status==='processing'?'正在读取图片…':'商品图片待补充'}</span>}</button>
     <div className="shelf-card-meta"><span className={'shelf-state '+(busy?'busy':'')} role="status">{shelfStatus(entry)}</span>{placed&&<span>房间中</span>}</div><strong title={entry.name}>{entry.name}</strong><small className="shelf-spec">{entry.variantName||shelfCategory(entry)}{entry.dimensions?.width&&entry.dimensions?.depth?` · ${Math.round(entry.dimensions.width*100)} × ${Math.round(entry.dimensions.depth*100)} cm`:''}</small><span className="shelf-price">{entry.kind==='model'?'已保存场景物品':money(entry)}</span>
     {busy&&<small className="shelf-progress">{entry.modelStage||'正在读取商品图片和规格…'}</small>}
     {!ready&&!busy&&['needs_login','error','incomplete'].includes(entry.status)&&<small className="shelf-progress">{entry.snapshot?.error||entry.error||'商品信息未读完整，可登录后重试。'}</small>}
     {entry.status==='needs_selection'&&entry.snapshot?.variants?.length>0&&<select aria-label={'选择款式：'+entry.name} value="" onChange={async e=>{try{resolveShelf(entry.id,await request('products/'+entry.importId+'/variant',{variantId:e.target.value}));}catch(err){setError(err.message);}}}><option value="" disabled>请选择商品款式</option>{entry.snapshot.variants.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>}
     <div className="shelf-card-actions"><button className={ready?'btn-primary':''} disabled={busy&&!ready||entry.status==='needs_selection'} onClick={e=>{if(ready){e.currentTarget.focus();choose(entry);}else {setError('');read(keepInShelf(entry),true);}}}>{ready?'放入房间':busy?'准备中…':entry.status==='pending'?'读取商品':'重新读取'}</button><button onClick={e=>{e.currentTarget.focus();setSelected({entry,info:true});}}>详情</button><button aria-label={'从储物栏移除：'+entry.name} onClick={()=>removeFromShelf(entry.id)}>移除</button></div>
     {entry.importId&&['needs_login','error','incomplete'].includes(entry.status)&&<button onClick={async()=>{try{await request('products/'+entry.importId+'/open-browser',{});onMessage('请在商品窗口完成登录或验证，再点重新读取。');}catch(err){setError(err.message);}}}>打开商品窗口</button>}
    </article>;})}
    {showBuiltins&&builtin.map(a=><article className="shelf-card builtin-card" key={'asset:'+a.id} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-roomvoice-product','asset:'+a.id);}}><button className="shelf-thumb" aria-label={'放入 '+a.name} onClick={()=>addAsset(a)}><AssetArt asset={a}/></button><div className="shelf-card-meta"><span>内置素材</span><span>可直接摆放</span></div><strong>{a.name}</strong><small>{Math.round(a.dimensions.width*100)} × {Math.round(a.dimensions.depth*100)} cm · 可调整</small><button className="btn-primary" onClick={()=>addAsset(a)}>放入房间</button></article>)}
    {!resultCount&&!showBuiltins&&!loading&&!loadError&&<div className="shelf-empty"><p>粘贴商品链接导入，或切换“内置素材”直接体验。地毯可以用上方快捷按钮添加。</p></div>}
    {showBuiltins&&!resultCount&&(tab==='assets'||!loading&&!loadError)&&<p className="shelf-empty">没有匹配的内置素材，试试其他分类或关键词。</p>}
   </div><div className="shelf-bottom"><small>点“放入房间”或拖进3D画布；选中场景物品后可“放回储物栏”。</small>{!isShowcase && <><details><summary>Excel填写说明</summary><p>模板中每件商品填一行。商品链接必填，宽、深、高使用厘米；价格和评论不知道可留空。</p></details><button onClick={load} disabled={loading}>{loading?'正在刷新…':'刷新物品库'}</button></>}</div>
  </div>
  {selected&&<ProductDialog className="inventory-modal" label="商品规格与信息" onDismiss={()=>setSelected(null)}><button autoFocus className="modal-close" onClick={()=>setSelected(null)} aria-label="关闭商品信息">×</button><h2>{selected.entry.name}</h2><div className="product-dialog-content">{selected.entry.image&&<img src={selected.entry.image} alt={selected.entry.name}/>}<div><strong>{money(selected.entry)}</strong><p>{selected.entry.description||'原表与商品页未提供额外介绍。'}</p><p>{reviewText(selected.entry)}</p><small>来源：{selected.entry.metadataSource||'用户储物栏'} · {selected.entry.fetchedAt?new Date(selected.entry.fetchedAt).toLocaleString():''}</small>{selected.entry.sourceUrl&&<a href={selected.entry.sourceUrl} target="_blank" rel="noreferrer">查看原商品 ↗</a>}</div></div>
   <ProductModelReview record={selected.entry.snapshot} dimensions={selected.info?selected.entry.dimensions:dims} selectedModelId={selected.info?preferredModel(selected.entry.snapshot):model} onMessage={onMessage} onUpdate={next=>{setSelected(old=>old?{...old,entry:{...old.entry,snapshot:next}}:old);setModel(old=>next.models?.some(m=>m.id===old&&m.canApply!==false)?old:preferredModel(next));}}/>
   {!selected.info&&<><div className="field-triple">{[['宽','width'],['深','depth'],['高','height']].map(([label,k])=><label key={k}>{label}（米）<input aria-label={'入库商品'+label} type="number" min=".01" max="8" step=".01" value={dims[k]??''} onChange={e=>{setDims(old=>({...old,[k]:e.target.valueAsNumber}));setConfirmed(false);}}/></label>)}</div><label>模型来源<select value={model} onChange={e=>{setModel(e.target.value);setConfirmed(false);}}><option value="" disabled>请选择近似模型</option>{(selected.entry.snapshot?.models||[]).map(m=><option key={m.id} value={m.id} disabled={m.canApply===false}>{m.label}</option>)}</select></label><p>{selected.entry.assetId==='rug'&&!selected.entry.snapshot?.selectedVariant?.dimensions?.height?'商家未提供厚度，默认按1.2厘米的场景示意厚度摆放，可自行调整；不代表商品实际厚度。':'尺寸、外形接近即可加入房间，之后可以自由缩放和调整。'}</p><button className="btn-primary" disabled={!model||selected.entry.snapshot?.models?.find(m=>m.id===model)?.canApply===false||!['width','depth','height'].every(k=>Number.isFinite(dims[k])&&dims[k]>0)} onClick={()=>{if(add(selected.entry,selected.position,dims,model)){const known=confirmations();known[selected.entry.id]={version:selected.entry.snapshot.analyzedAt,dimensions:dims,model};localStorage.setItem('roomvoice-inventory-confirmed',JSON.stringify(known));setSelected(null);}}}>加入房间</button></>}
   {onBakeProduct&&selected.entry.status==='ready'&&<details><summary>高级选项（可选）</summary><button onClick={()=>onBakeProduct({...selected.entry,confirmedDimensions:selected.info?selected.entry.dimensions:dims,chosenModel:selected.info?preferredModel(selected.entry.snapshot):model})}>制作此商品的2K烘焙模型</button></details>}
  </ProductDialog>}
 </section>;
}
