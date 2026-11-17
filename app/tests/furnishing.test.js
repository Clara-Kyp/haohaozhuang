import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {assets,changeItem,removeItem,furnishingWarning,requireFurnishing,freshFurnishing} from '../src/furnishing.js';
import {writeProject,readProject} from '../src/persistence.js';
import {useStudio,serializeProject} from '../src/store.js';
const scene={width:5,depth:4,height:2.75,roomType:'living'};
const items=()=>[
 {id:'table',assetId:'coffee',name:'茶几',x:0,z:0,rotation:0,elevation:0,...assets.coffee.dimensions},
 {id:'vase',assetId:'vase',name:'花器',parentId:'table',x:.2,z:0,rotation:0,elevation:.408,...assets.vase.dimensions},
];
test('桌面配饰随宿主移动旋转，宿主删除不会留下悬浮配饰',()=>{
 const next=changeItem(items(),'table',{x:1,z:-.2,rotation:90});
 assert.ok(Math.abs(next[1].x-1)<1e-8);assert.ok(Math.abs(next[1].z+.4)<1e-8);
 assert.equal(furnishingWarning(next,scene),'');assert.equal(removeItem(next,'table').length,0);
});
test('锁定阻止改动，解锁后可编辑；边界和实物相撞会阻止应用',()=>{
 const locked=items().map(i=>({...i,locked:true}));assert.equal(changeItem(locked,'table',{x:2}),locked);
 assert.equal(changeItem(locked,'table',{locked:false})[0].locked,false);
 assert.match(furnishingWarning(changeItem(items(),'table',{x:4}),scene),/边界/);
 assert.match(furnishingWarning([...items(),{...items()[0],id:'collision'}],scene),/重叠/);
 assert.throws(()=>requireFurnishing({source:'demo',items:items(),summary:'示意'},scene));
});
test('确认加载陈设是一条可撤销操作；完整存档保留参考、提案和物件',async()=>{
 const store=()=>useStudio.getState();store().resetProject();store().load({...scene,items:[],furnishingApplied:false},0);
 store().edit({furnishingApplied:true,items:items()});store().undo();assert.equal(store().scene.furnishingApplied,false);
 const draft={...freshFurnishing(),references:[{image:'data:image/png;base64,AA=='}],proposal:{items:items(),summary:'会客搭配'}};
 await writeProject(serializeProject({rooms:[{name:'客厅'}],roomScenes:{0:{...scene,furnishingApplied:true,items:items()}},furnishingDrafts:{0:draft}}));
 const saved=await readProject();assert.deepEqual(saved.furnishingDrafts[0],draft);assert.deepEqual(saved.roomScenes[0].items,items());
});
test('墙饰不能遮挡示意窗洞，移动到窗侧后可保留',()=>{
 const art={id:'art',assetId:'art',name:'装饰画',x:0,z:-1.98,elevation:1.2,rotation:0,...assets.art.dimensions};
 assert.match(furnishingWarning([art],scene),/窗洞/);
 assert.equal(furnishingWarning([{...art,x:2}],scene),'');
});
test('地毯优先铺在茶几附近，可与落地家具叠放，窄房间会适配尺寸',async()=>{
 const {newItem}=await import('../src/furnishing.js');const placed=items(),s={...scene,items:placed};const rug=newItem('rug',s);assert.ok(rug);assert.equal(rug.x,0);assert.equal(rug.z,0);assert.equal(furnishingWarning([...placed,rug],s),'');
 const narrow={width:1.4,depth:1.8,height:2.75,roomType:'living',items:[]},small=newItem('rug',narrow);assert.ok(small);assert.ok(small.width<=1.2);assert.ok(small.depth<=1.6);assert.equal(furnishingWarning([small],narrow),'');
});
test('已布置房间的地毯指令生成可编辑物件，可移除和撤销，不再只改旧开关',async()=>{
 const {proposalPatch}=await import('../src/store.js');const s={...scene,furnishingApplied:true,items:items()};const patch=proposalPatch({rug:'茶几下'},s);assert.equal(patch.rug,'无地毯');assert.equal(patch.items.filter(i=>i.assetId==='rug').length,1);assert.equal(s.items.length,2);assert.equal(furnishingWarning(patch.items,s),'');const cleared=proposalPatch({rug:'无地毯'},{...s,...patch});assert.equal(cleared.items.length,2);
});
