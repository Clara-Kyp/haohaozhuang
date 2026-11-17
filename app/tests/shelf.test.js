import test from 'node:test';import assert from 'node:assert/strict';
import {productLink,productKey,shelfEntry,readShelf,writeShelf,keepInShelf,resolveShelf,mergeShelf,removeFromShelf,shelfCategory,shelfStatus} from '../src/shelfTools.js';
function storage(run){const old=[globalThis.localStorage,globalThis.window],data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};globalThis.window={dispatchEvent:()=>{}};try{return run(data);}finally{[globalThis.localStorage,globalThis.window]=old;}}
const record={id:'import',status:'ready',title:'真实椅子',sourceUrl:'https://detail.tmall.com/item.htm?id=123&skuId=green',selectedVariantId:'green',variants:[{id:'green',name:'绿色',price:500,currency:'CNY',dimensions:{width:.8,depth:.9,height:1}}],images:[{url:'/real.jpg'}],models:[{type:'reference_model',url:'/real.glb'}]};
test('分享链接去重且区分SKU，不接受脚本或非HTTPS',()=>{
 assert.equal(productLink('分享 https://detail.tmall.com/item.htm?id=123&skuId=green。'),record.sourceUrl);assert.equal(productKey(record.sourceUrl),productKey('https://item.taobao.com/item.htm?skuId=green&id=123&spm=x'));assert.notEqual(productKey(record.sourceUrl),productKey('https://item.taobao.com/item.htm?id=123&skuId=other'));assert.throws(()=>productLink('javascript:alert(1)'));
});
test('旧购物车仅迁移物品资料，不保留数量合计功能，原商品不会丢失',()=>storage(data=>{
 data.set('roomvoice-shopping-cart-v1',JSON.stringify([{sourceUrl:record.sourceUrl,name:'椅子',quantity:3,price:500,importId:'import'}]));const next=readShelf();assert.equal(next.items.length,1);assert.equal(next.items[0].quantity,undefined);assert.equal(next.items[0].sourceUrl,record.sourceUrl);assert.equal(next.items[0].price,500);assert.equal(data.has('roomvoice-shopping-cart-v1'),false);assert.deepEqual(readShelf(),JSON.parse(JSON.stringify(next)));
}));
test('储物栏同款去重，与服务端候选合并不重复显示，移除后异步结果不复活',()=>storage(()=>{
 keepInShelf({snapshot:record,name:record.title});keepInShelf({snapshot:record,name:record.title});assert.equal(readShelf().items.length,1);const merged=mergeShelf([{snapshot:record,name:record.title}],readShelf());assert.equal(merged.length,1);removeFromShelf(merged[0].id);resolveShelf(merged[0].id,record);assert.equal(mergeShelf([{snapshot:record}],readShelf()).length,0);
}));
test('场景物件放回保留模型与尺寸快照，商品规格与展示状态来自实际记录',()=>storage(()=>{
 const scene={id:'chair',assetId:'armchair',name:'场景椅',x:1,z:0,width:1.1,depth:1.2,height:1.3,productModel:{url:'/original.glb'},product:{snapshot:record}};const entry=keepInShelf(scene);scene.productModel.url='/changed.glb';assert.equal(entry.sceneItem.productModel.url,'/original.glb');assert.equal(entry.sceneItem.width,1.1);assert.equal(entry.dimensions.width,.8);assert.equal(entry.price,500);assert.equal(shelfStatus(entry),'模型已就绪');assert.equal(shelfCategory({assetId:'rug'}),'地毯');assert.equal(shelfCategory({assetId:'vase'}),'配饰');assert.equal(shelfCategory({id:'vase'}),'配饰');
}));
test('读取任务完成后替换临时ID、保留移回模型，真实错误不显示为准备成功',()=>storage(()=>{
 const temporary=keepInShelf({sourceUrl:'https://detail.tmall.com/item.htm?id=123',name:'待读取商品',status:'pending',autoPrepared:false});resolveShelf(temporary.id,record);assert.equal(readShelf().items.length,1);assert.equal(readShelf().items[0].id,productKey(record.sourceUrl));assert.equal(readShelf().items[0].autoPrepared,true);assert.equal(shelfStatus({...readShelf().items[0],status:'needs_login'}),'需要登录或验证');
}));
