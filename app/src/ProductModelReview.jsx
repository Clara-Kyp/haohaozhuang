import React,{useEffect,useRef,useState} from 'react';
import ProductDialog from './ProductDialog';
async function request(path,body){const r=await fetch('/api/products/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined),d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'模型核对暂不可用。');return d;}
export default function ProductModelReview({record,dimensions,onUpdate,onMessage,disabled=false,selectedModelId}){
 const [error,setError]=useState(''),[starting,setStarting]=useState(false),[zoom,setZoom]=useState(false),[instructions,setInstructions]=useState(''),update=useRef(onUpdate);update.current=onUpdate;
 const build=record?.modelBuild,busy=starting||['queued','processing'].includes(build?.status),detail=record?.models?.find(m=>m.type==='reference_model');
 useEffect(()=>{if(!record?.id||!['queued','processing'].includes(build?.status))return;let stop=false;const timer=setInterval(async()=>{try{const next=await request(record.id);if(!stop){update.current(next);if(next.modelBuild?.status==='ready')window.dispatchEvent(new Event('roomvoice-inventory-updated'));}}catch(e){if(!stop)setError(e.message);}},1600);return()=>{stop=true;clearInterval(timer);};},[record?.id,build?.status]);
 useEffect(()=>{if(!record?.id)return;let stop=false;request(record.id).then(next=>{if(!stop)update.current(next);}).catch(()=>{});return()=>{stop=true;};},[record?.id]);
 async function stop(){try{update.current(await request(record.id+'/stop-model',{}));window.dispatchEvent(new Event('roomvoice-inventory-updated'));}catch(e){setError(e.message);}}
 async function refine(){setError('');setStarting(true);try{const next=await request(record.id+'/refine',{dimensions,instructions});update.current(next);onMessage?.('正在使用缓存图片生成近似模型，完成后即可摆放。');}catch(e){setError(e.message);}finally{setStarting(false);}}
 if(!record?.id)return null;
 return <section className="product-model-review" aria-label="商品造型核对"><h4>近似模型预览</h4>
  {detail&&selectedModelId&&selectedModelId!==detail.id&&<p className="notice">以下预览和检查针对细化模型。当前选择“{record.models.find(m=>m.id===selectedModelId)?.label}”，应用后的外形以所选模型为准。</p>}
  {detail?.previewUrl&&<><div className="model-compare"><figure><img src={record.images?.[0]?.url} alt="实际商品参考图"/><figcaption>商品原图</figcaption></figure><figure><button onClick={e=>{e.currentTarget.focus();setZoom(true);}} aria-label="放大模型多角度预览"><img src={detail.previewUrl} alt="近似模型预览"/></button><figcaption>模型预览 · 点击放大</figcaption></figure></div><small>按商品图片近似呈现，可自行调整尺寸与摆放。</small></>}
  {busy&&<button onClick={stop}>停止生成，使用现有模型</button>}
  {busy&&<p role="status">{build?.stage||'准备核对商品模型…'}</p>}
  {(error||(!detail&&build?.error))&&<p role="alert" className="notice warn">{error||build.error}</p>}
  <label>调整外形（选填）<textarea aria-label="造型修正说明" rows={2} maxLength={2500} value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="例如：靠背应后仰，扶手更圆润，底座是四根扁平支脚" disabled={disabled||busy}/></label>
  <button disabled={disabled||busy||record.status!=='ready'} onClick={refine}>{busy?'正在生成近似模型…':detail?'重新生成近似模型（可选）':'生成近似模型（可选）'}</button>
  {detail&&<a href={'/api/products/'+record.id+'/model-project'} download>下载细化模型Blender工程</a>}
  <small>尺寸和主要外形相近即可试摆；可直接调整尺寸，无需追求细节完全一致。</small>
  {zoom&&detail?.previewUrl&&(
   <ProductDialog className="product-image-viewer" label="模型预览" onDismiss={()=>setZoom(false)} dismissOnBackdrop>
    <button autoFocus onClick={()=>setZoom(false)} aria-label="关闭模型预览">×</button>
    <img src={detail.previewUrl} alt="细化模型多角度预览"/>
   </ProductDialog>
  )}
 </section>;
}
