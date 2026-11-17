import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assets,newItem,furnishingWarning,changeItem} from '../src/furnishing.js';
import {showroomSnapshot,restoreShowroom,transformItems,sceneSignature,sourceModelSignature} from '../src/buildTools.js';
import {writeProject,readProject} from '../src/persistence.js';
const item=(id,x=0)=>({id,assetId:'armchair',name:'椅子',...assets.armchair.dimensions,x,z:0,elevation:0,rotation:0,parentId:null,locked:false});
const scene=()=>({width:5,depth:4,height:2.75,roomType:'living',faces:{floor:'橡木地板',ceiling:'白漆'},items:[item('chair')],furnishingApplied:true});
test('自由升降有显式标记，保留三维边界与不同高度的碰撞判断',()=>{
 const s=scene();const moved=transformItems(s,'chair',{elevation:1.1},.05);
 assert.equal(moved[0].elevation,1.1);assert.equal(moved[0].freePlacement,true);assert.equal(s.items[0].elevation,0);
 assert.throws(()=>transformItems(s,'chair',{elevation:2.7}),/边界/);
 assert.equal(furnishingWarning([item('a'),{...item('b'),elevation:1.1,freePlacement:true}],s),'');
 assert.match(furnishingWarning([item('a'),{...item('b'),elevation:.3,freePlacement:true}],s),/重叠/);
});
test('样板间保存不可变快照，恢复物件款式、锁定、位置、支撑与饰面',()=>{
 const s=scene();s.items[0].product={variantId:'green',images:[{url:'/image.jpg'}]};s.items[0].locked=true;
 s.showroom=showroomSnapshot(s);s.items[0].product.variantId='white';s.items=[];s.faces.floor='瓷砖';
 const restored=restoreShowroom(s);assert.equal(restored.items[0].product.variantId,'green');assert.equal(restored.items[0].locked,true);assert.equal(restored.faces.floor,'橡木地板');assert.equal(s.items.length,0);
});
test('移动后场景烘焙失效、物件自身烘焙仍有效；改尺寸清除物件烘焙',()=>{
 const s=scene(),one=s.items[0],sig=sourceModelSignature(one),full=sceneSignature(s);one.bakedModel={signature:sig,url:'/baked.glb'};
 const moved=transformItems(s,one.id,{x:1.02},.05);assert.equal(moved[0].x,1);assert.equal(sourceModelSignature(moved[0]),sig);assert.notEqual(sceneSignature({...s,items:moved}),full);
 const resized=transformItems(s,one.id,{width:one.width+.1});assert.equal(resized[0].bakedModel,null);
});
test('无台面时可显式自由放置配饰，默认规划仍要求真实支撑',()=>{
 const s={...scene(),items:[]};assert.equal(newItem('vase',s),null);
 const vase=newItem('vase',s,null,true);assert.ok(vase);assert.equal(vase.freePlacement,true);assert.equal(furnishingWarning([vase],s),'');
});
test('跨存档保留样板间和2K资产，物件移动仍可回到原版本',async()=>{
 const s=scene();s.showroom=showroomSnapshot(s);s.bake={sourceSignature:sceneSignature(s),room:{build:'/build.glb',showroom:'/full.glb'},assets:{chair:{url:'/chair.glb',signature:sourceModelSignature(s.items[0])}}};
 await writeProject({roomScenes:{0:s}});const saved=await readProject();assert.deepEqual(saved.roomScenes[0],s);assert.deepEqual(restoreShowroom(saved.roomScenes[0]).items,s.items);
});
test('储物栏移回的物品保留商品模型和尺寸，原位置占用时寻找空位',async()=>{
 const {restoreStoredItem}=await import('../src/buildTools.js');const s=scene(),saved={...item('returned'),width:.9,productModel:{type:'reference_model',url:'/cached.glb'},product:{variantId:'brown'},color:'#aa7744',bakedModel:{url:'/old.glb'}};
 const next=restoreStoredItem(s,saved),restored=next.at(-1);
 assert.notEqual(restored.id,saved.id);assert.equal(restored.width,.9);assert.deepEqual(restored.productModel,saved.productModel);assert.deepEqual(restored.product,saved.product);assert.equal(restored.color,saved.color);assert.equal(restored.bakedModel,null);assert.equal(furnishingWarning(next,s),'');assert.equal(s.items.length,1);
});
