import {assets} from './furnishing.js';
export const SHELF_EVENT='roomvoice-shelf-updated';
const STORAGE='roomvoice-shelf-v1';
export function productLink(text){
 const match=String(text||'').match(/https:\/\/[^\s<>"「」]+/);if(!match)throw new Error('请粘贴HTTPS商品链接，或包含链接的分享文字。');
 let u;try{u=new URL(match[0].replace(/&amp;/g,'&').replace(/[，。；、）)】\]]+$/,''));}catch{throw new Error('商品链接格式不正确。');}
 if(u.protocol!=='https:'||u.username||u.password)throw new Error('请输入有效的HTTPS商品链接。');return u.href;
}
export function productKey(url,variant=''){
 const u=new URL(productLink(url)),sku=variant||u.searchParams.get('skuId')||u.searchParams.get('sku_id')||u.searchParams.get('variant')||'';
 if(/(^|\.)(taobao|tmall)\.com$/.test(u.hostname)&&u.searchParams.has('id'))return 'taobao:'+u.searchParams.get('id')+'#'+sku;
 for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['spm','gclid','fbclid'].includes(k))u.searchParams.delete(k);
 u.hash='';u.searchParams.sort();return u.href+'#'+sku;
}
export function shelfEntry(value){
 const record=value.snapshot||value.product?.snapshot,product=value.product;
 const variant=record?.variants?.find(v=>String(v.id)===String(product?.variantId||record.selectedVariantId));
 const url=product?.sourceUrl||value.sourceUrl||value.productUrl||record?.sourceUrl;
 const sourceUrl=url?productLink(url):'',variantId=product?.variantId||variant?.id||value.variantId||'';
 const dimensions=variant?.dimensions||product?.dimensions||value.dimensions||Object.fromEntries(['width','depth','height'].filter(k=>Number.isFinite(value[k])).map(k=>[k,value[k]]));
 const modelReady=record?.models?.some(m=>['reference_model','source_model'].includes(m.type)&&m.canApply!==false);
 const {quantity,selected,...metadata}=value;
 return {...metadata,id:sourceUrl?productKey(record?.resolvedUrl?.startsWith('https:')?record.resolvedUrl:sourceUrl,variantId):value.id?.startsWith('model:')?value.id:'model:'+JSON.stringify([value.assetId,value.color,dimensions.width,dimensions.depth,dimensions.height]),kind:sourceUrl?'product':'model',sourceUrl,variantId,name:product?.title||value.name||record?.title||'正在读取商品',image:record?.images?.[0]?.url||value.image||product?.images?.[0]?.url,price:variant?.price??value.price??null,currency:variant?.currency||value.currency||'CNY',variantName:variant?.name||value.variantName||product?.variantName||'',dimensions,description:record?.description||value.description||'',reviews:record?.reviews||value.reviews||{},assetId:record?.assetId||value.assetId,importId:record?.id||product?.importId||value.importId,status:record?.status||value.status||(sourceUrl?'pending':'model'),snapshot:record,modelState:modelReady?'ready':record?.modelBuild?.status||value.modelState||'pending',modelStage:record?.modelBuild?.stage||value.modelStage||'',modelError:record?.modelBuild?.error||value.modelError||'',autoPrepared:!sourceUrl||modelReady||value.autoPrepared===true,...(Number.isFinite(value.x)&&value.assetId?{sceneItem:structuredClone(value)}:{})};
}
export function readShelf(){
 try{let data=JSON.parse(localStorage.getItem(STORAGE)||'null');if(!data){const old=JSON.parse(localStorage.getItem('roomvoice-shopping-cart-v1')||'[]');data={items:Array.isArray(old)?old.map(shelfEntry):[],hidden:[]};localStorage.setItem(STORAGE,JSON.stringify(data));localStorage.removeItem('roomvoice-shopping-cart-v1');}return {items:Array.isArray(data.items)?data.items:[],hidden:Array.isArray(data.hidden)?data.hidden:[]};}catch{return {items:[],hidden:[]};}
}
export function writeShelf(data){localStorage.setItem(STORAGE,JSON.stringify(data));window.dispatchEvent(new Event(SHELF_EVENT));return data;}
export function keepInShelf(value){const entry=shelfEntry(value),data=readShelf(),old=data.items.find(i=>i.id===entry.id);if(old&&!entry.snapshot)Object.assign(entry,{snapshot:old.snapshot,autoPrepared:old.autoPrepared,modelState:old.modelState,importId:entry.importId||old.importId});writeShelf({hidden:data.hidden.filter(id=>id!==entry.id),items:[...data.items.filter(i=>i.id!==entry.id),{...old,...entry}]});return entry;}
export function updateShelf(id,patch){const data=readShelf();return writeShelf({...data,items:data.items.map(i=>i.id===id?{...i,...patch}:i)});}
export function resolveShelf(id,record){const data=readShelf(),old=data.items.find(i=>i.id===id);if(!old)return;const entry=shelfEntry({...old,snapshot:record,name:record.title||old.name,autoPrepared:true});return writeShelf({...data,items:[...data.items.filter(i=>i.id!==id&&i.id!==entry.id),entry]});}
export function removeFromShelf(id){const data=readShelf();writeShelf({hidden:[...new Set([...data.hidden,id])],items:data.items.filter(i=>i.id!==id)});}
export function mergeShelf(server,stored){const map=new Map(server.map(shelfEntry).map(e=>[e.id,e]));for(const e of stored.items){const base=map.get(e.id),newer=base?.snapshot&&(!e.snapshot||Date.parse(base.snapshot.analyzedAt||0)>Date.parse(e.snapshot.analyzedAt||0));map.set(e.id,{...base,...e,...(newer?base:{}),sceneItem:e.sceneItem});}return [...map.values()].filter(e=>!stored.hidden.includes(e.id));}
export function shelfCategory(entry){const a=assets[entry.assetId||entry.id];if(a?.placement==='rug'||/地毯|carpet|\brug\b/i.test(entry.name))return '地毯';if(a?.category==='灯具'||/灯|lamp/i.test(entry.name))return '灯具';if(['配饰','织物','绿植','摆件','挂饰'].includes(a?.category))return '配饰';return '家具';}
export function shelfStatus(entry){if(entry.kind==='model')return '可直接摆放';if(entry.status==='pending')return '准备读取';if(entry.status==='processing')return '读取商品中';if(entry.status==='needs_selection')return '请选择款式';if(['needs_login','error','incomplete'].includes(entry.status))return entry.status==='needs_login'?'需要登录或验证':'读取未完成';if(entry.modelState==='ready')return '模型已就绪';if(['queued','processing'].includes(entry.modelState)||entry.modelState==='pending'&&entry.autoPrepared)return '生成模型中';return '可用相似模型';}
