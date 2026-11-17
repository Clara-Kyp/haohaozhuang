import React,{useEffect,useRef,useState} from 'react';
import ProductDialog from './ProductDialog';
import {applyProductToItems,preferredModel} from './productTools';
import ProductModelReview from './ProductModelReview';
async function request(path,body){const r=await fetch('/api/products/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'商品服务暂不可用。');return data;}
const labels={source_model:'商品页提供的模型',image_reconstruction:'旧版几何草模',reference_model:'按商品图细化的近似模型',similar:'相似素材模型'};
export default function ProductImport({item,scene,onItems,onMessage}){
  const [expanded,setExpanded]=useState(!item.product);
  const [previewImage,setPreviewImage]=useState(null);
  const [url,setUrl]=useState(item.productUrl||''),[record,setRecord]=useState(item.product?.snapshot||null),[error,setError]=useState(''),[starting,setStarting]=useState(false),[model,setModel]=useState(item.product?.modelId||''),[dims,setDims]=useState(item.product?.dimensions||{}),[confirmed,setConfirmed]=useState(false),[color,setColor]=useState(item.color||'');
  const alive=useRef(true),sequence=useRef(0);useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
  const processing=starting||['queued','processing'].includes(record?.modelBuild?.status)||(record?.status==='processing'&&!error);
  useEffect(()=>{if(!item.product?.importId)return;let stop=false;request(item.product.importId).then(next=>{if(!stop)setRecord(next);}).catch(()=>{});return()=>{stop=true;};},[item.product?.importId]);
  useEffect(()=>{
    if(!record?.id||record.status!=='processing')return;
    let stopped=false,timer;const began=Date.now(),seq=sequence.current;
    const poll=async()=>{try{const next=await request(record.id);if(stopped||seq!==sequence.current)return;setRecord(next);if(next.status==='processing'){if(Date.now()-began>240000){setError('商品读取超时，可点击重新读取。原场景未修改。');return;}timer=setTimeout(poll,1200);}}catch(e){if(!stopped&&seq===sequence.current)setError(e.message);}};poll();return()=>{stopped=true;clearTimeout(timer);};
  },[record?.id,record?.status]);
  useEffect(()=>{
    if(record?.status!=='ready')return;
    const variant=record.variants?.find(v=>v.id===record.selectedVariantId);
    setDims({...variant?.dimensions});setModel(preferredModel(record));setColor(record.color||'');setConfirmed(false);
  },[record?.id,record?.status,record?.selectedVariantId,record?.modelBuild?.modelId]);
  useEffect(()=>{setModel(old=>record?.models?.some(m=>m.id===old&&m.canApply!==false)?old:preferredModel(record));},[record?.models]);
  async function begin(value=url){
    if(item.locked||starting)return;const seq=++sequence.current;
    setUrl(value);setStarting(true);setError('');setConfirmed(false);setRecord(null);
    try{const next=await request('import',{url:value,targetAssetId:item.assetId});if(alive.current&&seq===sequence.current)setRecord(next);}catch(e){if(alive.current&&seq===sequence.current)setError(e.message);}finally{if(alive.current&&seq===sequence.current)setStarting(false);}
  }
  async function action(path,body={}){setError('');try{const next=await request(record.id+'/'+path,body);if(alive.current&&path!=='open-browser')setRecord(next);if(next.message)onMessage(next.message);}catch(e){if(alive.current)setError(e.message);}}
  const variant=record?.variants?.find(v=>v.id===record.selectedVariantId),selectedModel=record?.models?.find(m=>m.id===model);
  const imageViewer=previewImage&&(
    <ProductDialog className="product-image-viewer" label="商品图片预览" onDismiss={()=>setPreviewImage(null)} dismissOnBackdrop>
      <button autoFocus onClick={()=>setPreviewImage(null)} aria-label="关闭图片预览">×</button>
      <img src={previewImage} alt={record?.title||item.name}/>
    </ProductDialog>
  );
  if(!expanded&&item.product)return <section className="product-summary" aria-label="已缓存商品">
    {item.product.images?.[0]&&<button className="cached-product-thumb" onClick={e=>{e.currentTarget.focus();setPreviewImage(item.product.images[0].url);}} aria-label="查看商品图片"><img src={item.product.images[0].url} alt={item.product.variantName}/></button>}
    <div><strong>{item.product.variantName}</strong><p>宽 {Math.round(item.width*100)} · 深 {Math.round(item.depth*100)} · 高 {Math.round(item.height*100)} cm</p><small>{item.productModel?.type==='image_reconstruction'?'可选择近似模型直接摆放。':'图片和模型已缓存，摆放时不会打开商品页。'}</small></div>
    <div className="row"><button onClick={()=>setExpanded(true)}>调整近似模型</button><button onClick={()=>setExpanded(true)}>更换商品</button><a href={item.product.sourceUrl} target="_blank" rel="noreferrer">手动查看商品 ↗</a></div>{imageViewer}
  </section>;
  return <section className="product-import" aria-label="真实商品导入">
    <h3>从商品链接导入</h3>
    <label>商品详情链接<input type="url" aria-label="商品详情链接" value={url} placeholder="粘贴淘宝、天猫或其他商品详情链接" disabled={item.locked||starting} onChange={e=>setUrl(e.target.value)} onPaste={e=>{const text=e.clipboardData.getData('text');if(/https:\/\//.test(text)){e.preventDefault();begin(text);}}}/></label>
    <div className="row"><button disabled={item.locked||processing||!url.trim()} onClick={()=>begin()}>读取商品与默认规格</button>{record&&<button disabled={processing||item.locked} onClick={()=>record.status==='processing'?begin():action('refresh')}>重新读取</button>}</div>
    {processing&&<p role="status" className="product-progress">{['queued','processing'].includes(record?.modelBuild?.status)?record.modelBuild.stage:record?.stage||'正在读取商品…'}</p>}
    {(error||record?.error)&&<p role="alert" className="notice warn">{error||record.error}</p>}
    {record?.title&&<div className="product-details">
      <strong className="product-title">{record.title}</strong>
      <small>{record.brand} · 实际读取时间 {new Date(record.fetchedAt||record.createdAt).toLocaleString()}</small>
      {!!record.variants?.length&&<label>商品款式<select aria-label="商品款式" value={record.selectedVariantId||''} disabled={processing||item.locked} onChange={e=>{setConfirmed(false);action('variant',{variantId:e.target.value});}}>
        {!record.selectedVariantId&&<option value="">商品页没有默认款式，请选择</option>}{record.variants.map(v=><option key={v.id} value={v.id}>{v.name}{v.color&&!v.name.includes(v.color)?' · '+v.color:''}</option>)}
      </select></label>}
      {record.defaultReason&&<p className="product-default">{record.defaultReason}</p>}
      {!!record.images?.length&&<div className="product-gallery">{record.images.map((i,n)=><button key={i.url} onClick={e=>{e.currentTarget.focus();setPreviewImage(i.url);}} aria-label={'查看商品图 '+(n+1)}><img src={i.url} alt={`${record.title} · 当前款式商品图 ${n+1}`}/></button>)}</div>}
      {variant&&<p className="product-variant-meta">颜色：{variant.color||'页面未提供'}<br/>款式：{variant.style||variant.name}{variant.price&&<><br/>页面价格：{variant.currency} {variant.price}（以商品页为准）</>}</p>}
      {record.status==='ready'&&<>
        <div className="field-triple">{[['宽','width'],['深','depth'],['高','height']].map(([label,key])=><label key={key}>{label}（米）<input type="number" aria-label={'商品'+label+'（米）'} value={dims[key]??''} min={.01} max={8} step={.001} placeholder="未读到" disabled={item.locked} onChange={e=>{setDims(old=>({...old,[key]:e.target.value===''?'':e.target.valueAsNumber}));setConfirmed(false);}}/></label>)}</div>
        <details className="product-evidence"><summary>查看尺寸读取依据</summary>{['width','depth','height'].map(k=><p key={k}>{({width:'宽',depth:'深',height:'高'})[k]}：{variant?.dimensionEvidence?.[k]||'页面未提供，请按详情核对后填写。'}</p>)}</details>
        {!!record.missingDimensions?.length&&<p className="card-sub">部分尺寸未在页面或图片中读到，未用原物件尺寸冒充商品规格。请核对后补齐。</p>}
        <label>商品图取色<input type="color" aria-label="商品图取色" value={color||'#b7a189'} disabled={item.locked} onChange={e=>{setColor(e.target.value);setConfirmed(false);}}/></label>
        <ProductModelReview record={record} dimensions={dims} selectedModelId={model} disabled={item.locked} onUpdate={setRecord} onMessage={onMessage}/>
        <div className="product-models" aria-label="商品模型来源">{record.models?.map(m=><button key={m.id} aria-pressed={model===m.id} disabled={item.locked||m.canApply===false} onClick={()=>{setModel(m.id);setConfirmed(false);}}><strong>{m.label}</strong><small>{m.note}</small></button>)}</div>
        <p className="product-fidelity">{labels[selectedModel?.type]}{selectedModel?.type!=='source_model'?' · 非厂家同款模型':''}</p>
        <button className="btn-primary" disabled={item.locked||!model||selectedModel?.canApply===false||!['width','depth','height'].every(k=>Number.isFinite(dims[k])&&dims[k]>0)} onClick={()=>{try{const items=applyProductToItems(scene,item.id,record,model,dims,color);if(onItems(items)===false)return;onMessage('已按商品规格替换，商品卡已收起；可继续摆放。');setError('');setExpanded(false);window.dispatchEvent(new Event('roomvoice-inventory-updated'));}catch(e){setError(e.message);}}}>按商品规格替换此物件</button>
      </>}
      {!!record.notes?.length&&record.notes.map((v,n)=><p key={n} className="card-sub">{v}</p>)}
    </div>}
    {record&&['needs_login','error','incomplete'].includes(record.status)&&<div className="stack"><p>{record.stage}</p>{(record.status==='needs_login'||!record.images?.length)?<><button disabled={processing} onClick={()=>action('open-browser')}>打开商品浏览器，登录后续读</button><small>在弹出的本地商品浏览器完成登录或验证，然后点击“重新读取”。</small></>:<small>已保留真实商品图片。缺少可靠模型时需要补充同款参考或模型资源，无需反复打开商品页。</small>}</div>}
    {record?.status==='needs_selection'&&<p className="notice">{record.stage}</p>}
    {(record?.sourceUrl||item.productUrl)&&<a href={record?.sourceUrl||item.productUrl} target="_blank" rel="noreferrer">打开原商品页 ↗</a>}
    {item.product&&<p className="product-linked-state">当前物件已联动：{item.product.variantName} · {labels[item.product.modelRelation]}</p>}
    {imageViewer}
  </section>;
}
