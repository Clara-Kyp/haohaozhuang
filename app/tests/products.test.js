import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {applyProductToItems,preferredModel} from '../src/productTools.js';
import {assets} from '../src/furnishing.js';
import {useStudio} from '../src/store.js';
import {readProject,writeProject} from '../src/persistence.js';
const scene=()=>({width:5,depth:4,height:2.75,roomType:'living',furnishingApplied:true,items:[{id:'lamp',name:'原灯',assetId:'floor-lamp',...assets['floor-lamp'].dimensions,x:0,z:0,elevation:0,rotation:0,locked:false}]});
const record=()=>({id:'a-import',status:'ready',title:'商店三脚灯',sourceUrl:'https://shop.example.com/tripod',resolvedUrl:'https://shop.example.com/tripod',selectedVariantId:'white',assetId:'floor-lamp',variants:[{id:'white',name:'白色木架',color:'白色',dimensions:{width:.6,depth:.6,height:1.5},dimensionEvidence:{height:'高度150cm'}}],images:[{url:'/api/products/media/'+'a'.repeat(64)+'.jpg',sourceUrl:'https://cdn.example.com/product.jpg'}],models:[{id:'image-model',type:'image_reconstruction',geometry:{parts:[{type:'cylinder',position:[0,.85,0],size:[.35,.5,.3],rotation:[0,0,0],material:'fabric',color:'#eeeeee'}]}}]});
test('商品确认后同时替换图片、默认SKU、尺寸和模型，非仅保存链接',()=>{
 const s=scene(),r=record(),items=applyProductToItems(s,'lamp',r,'image-model',{width:.6,depth:.6,height:1.5},'#eeeeee');
 assert.equal(items[0].name,'商店三脚灯');assert.equal(items[0].width,.6);assert.equal(items[0].product.variantId,'white');
 assert.deepEqual(items[0].product.images,r.images);assert.equal(items[0].productModel.type,'image_reconstruction');assert.equal(s.items[0].name,'原灯');
});
test('缺少实际图片/款式/尺寸或越界时保留原场景，锁定禁止替换',()=>{
 const s=scene(),r=record();
 assert.throws(()=>applyProductToItems(s,'lamp',{...r,images:[]},'image-model',{width:.6,depth:.6,height:1.5}));
 assert.throws(()=>applyProductToItems(s,'lamp',r,'image-model',{width:.6,depth:.6}));
 assert.throws(()=>applyProductToItems(s,'lamp',r,'image-model',{width:7,depth:7,height:1.5}),/冲突/);
 assert.throws(()=>applyProductToItems({...s,items:[{...s.items[0],locked:true}]},'lamp',r,'image-model',{width:.6,depth:.6,height:1.5}),/解锁/);
 assert.equal(s.items[0].width,.36);
});
test('商品联动可撤销，并在存档往返后保留真实来源与图模型',async()=>{
 const s=scene(),r=record(),items=applyProductToItems(s,'lamp',r,'image-model',{width:.6,depth:.6,height:1.5});
 useStudio.getState().load(s,0);useStudio.getState().edit({items});useStudio.getState().undo();assert.equal(useStudio.getState().scene.items[0].name,'原灯');
 await writeProject({roomScenes:{0:{...s,items}}});const saved=await readProject();assert.deepEqual(saved.roomScenes[0].items[0].product,r&&items[0].product);assert.equal(saved.roomScenes[0].items[0].productModel.type,'image_reconstruction');
});
test('相似素材必须明确分类，不伪装商品页模型；未知模型URL不能应用',()=>{
 const s=scene(),r=record();r.models=[{id:'similar-floor-lamp',type:'similar',assetId:'floor-lamp'}];
 const next=applyProductToItems(s,'lamp',r,'similar-floor-lamp',{width:.6,depth:.6,height:1.5});assert.equal(next[0].product.modelRelation,'similar');assert.equal(next[0].productModel,null);
 r.models=[{id:'source',type:'source_model',url:'https://unknown.example.com/file.glb'}];assert.throws(()=>applyProductToItems(s,'lamp',r,'source',{width:.6,depth:.6,height:1.5}),/来源/);
});
test('无效模型不能替换，近似模型可直接调整尺寸而不重新生成',()=>{
 const s=scene(),r=record(),dims={width:.6,depth:.6,height:1.5};
 r.models=[{id:'detail',type:'reference_model',url:'/api/products/media/'+'b'.repeat(64)+'.glb',canApply:false,dimensions:dims}];
 assert.throws(()=>applyProductToItems(s,'lamp',r,'detail',dims),/造型差异/);
 r.models[0].canApply=true;const next=applyProductToItems(s,'lamp',r,'detail',{...dims,height:1.6});assert.equal(next[0].height,1.6);assert.equal(next[0].productModel.url,r.models[0].url);assert.equal(s.items[0].name,'原灯');
});
test('细化GLB替换保留已摆放坐标、旋转和自由升降，清除旧草模烘焙',()=>{
 const s=scene(),r=record(),dims={width:.6,depth:.6,height:1.5};Object.assign(s.items[0],{x:.7,z:.4,rotation:37,elevation:.3,freePlacement:true,bakedModel:{url:'/old.glb'}});
 r.models=[{id:'detail',type:'reference_model',url:'/api/products/media/'+'c'.repeat(64)+'.glb',canApply:true,dimensions:dims}];
 const next=applyProductToItems(s,'lamp',r,'detail',dims)[0];assert.equal(next.x,.7);assert.equal(next.z,.4);assert.equal(next.rotation,37);assert.equal(next.elevation,.3);assert.equal(next.productModel.type,'reference_model');assert.equal(next.bakedModel,null);assert.equal(s.items[0].bakedModel.url,'/old.glb');
});
test('细化失败不默认换成其他相似商品；商家模型与可核对细化模型才可预选',()=>{
 const r={models:[{id:'detail',type:'reference_model',canApply:false},{id:'another',type:'similar',assetId:'armchair'}]};assert.equal(preferredModel(r),'');
 r.models[0].canApply=true;assert.equal(preferredModel(r),'detail');r.models.push({id:'merchant',type:'source_model'});assert.equal(preferredModel(r),'merchant');
});
test('地毯缺厚度时允许明确的示意厚度试摆，不写成商家提供参数',async()=>{
 const {placementDimensions}=await import('../src/productTools.js');
 const record={id:'rug',assetId:'rug',status:'ready',title:'真实地毯',selectedVariantId:'a',variants:[{id:'a',dimensions:{width:1.6,depth:2.3},dimensionEvidence:{width:'商品长宽标注',depth:'商品长宽标注'}}],images:[{url:'/rug.jpg'}],models:[{id:'similar-rug',type:'similar',assetId:'rug'}]};
 const dims=placementDimensions(record);assert.equal(dims.height,.012);assert.equal(record.variants[0].dimensions.height,undefined);
 const s={width:5,depth:4,height:2.75,items:[{id:'target',assetId:'rug',name:'地毯',x:0,z:0,elevation:.008,rotation:0,width:1.6,depth:2,height:.012,locked:false}]};
 const next=applyProductToItems(s,'target',record,'similar-rug',dims);assert.equal(next[0].depth,2.3);assert.match(next[0].product.dimensionEvidence.height,/场景示意厚度/);assert.equal(next[0].product.snapshot.variants[0].dimensions.height,undefined);
 assert.equal(placementDimensions({...record,assetId:'armchair'}).height,undefined);
});
