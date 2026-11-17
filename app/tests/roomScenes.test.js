import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomScene,initialScene,classifyRoom} from '../src/roomScenes.js';
import {wallCommand,wallObjectWarning} from '../src/wallObjects.js';
import {proposalPatch,placement,useStudio} from '../src/store.js';

test('房间用途决定陈设；厨卫卧室不再沿用隐式沙发',()=>{
  for(const [name,kind,fixtures] of [['厨房','kitchen',['kitchen','fridge']],['卫生间','bath',['vanity','toilet','shower']],['卧室','bedroom',['bed','wardrobe']]]){
    const scene=createRoomScene({name},[3,4]);
    assert.equal(scene.roomType,kind);assert.equal(scene.hasSofa,false);
    assert.deepEqual(scene.furniture.map(v=>v.kind),fixtures);
    assert.equal(placement(scene),'');
  }
  assert.equal(createRoomScene({name:'未识别区域'},[3,4]).hasSofa,false);
  assert.equal(createRoomScene({name:'客厅'},[4,5]).hasSofa,true);
  assert.equal(classifyRoom({name:'客厅',kind:'other',kindConfirmed:true}),'other');
});
test('老存档修正默认客厅陈设，同时保留真实关联商品和自定义墙材质',()=>{
  const old={...initialScene,sceneVersion:undefined,faces:{...initialScene.faces,east:'粗石'}};
  const bath=createRoomScene({name:'卫生间'},[3,4],old);
  assert.equal(bath.hasSofa,false);assert.equal(bath.faces.floor,'浅灰哑光砖');assert.equal(bath.faces.east,'粗石');
  assert.equal(createRoomScene({name:'卧室'},[3,4],{...old,link:'https://example.com/sofa'}).hasSofa,true);
  const edited={...bath,tv:{enabled:true,wall:'east',centerHeight:.6,width:1.2,height:.68,offset:0}};
  assert.deepEqual(createRoomScene({name:'卫生间'},[3,4],edited).tv,edited.tv);
});
test('截图中的壁挂电视指令绑定选中的墙；未选墙时请求选墙',()=>{
  const result=wallCommand('墙面增加电视，客厅，壁挂，高60厘米',initialScene,'east');
  assert.equal(result.patch.tv.centerHeight,.6);assert.equal(result.patch.tv.wall,'east');
  assert.equal(result.patch.tv.height,.68);
  assert.deepEqual(wallCommand('增加壁挂电视',initialScene,null).patch,{});
  assert.equal(wallCommand('右侧墙电视屏幕高60厘米',initialScene,null).patch.tv.height,.6);
  assert.equal(wallCommand('换地砖并增加电视',initialScene,'east'),null);
});
test('电视提案可应用撤销；越界和窗洞重叠被校验',()=>{
  const scene=createRoomScene({name:'客厅'},[4,5]);
  const patch=proposalPatch(wallCommand('壁挂高60厘米的电视',scene,'east').patch,scene);
  assert.equal(placement({...scene,...patch}),'');
  useStudio.getState().load(scene,'wall-test');useStudio.getState().edit(patch);assert.equal(useStudio.getState().scene.tv.enabled,true);
  useStudio.getState().undo();assert.equal(useStudio.getState().scene.tv.enabled,false);
  assert.match(wallObjectWarning({...scene,tv:{...patch.tv,offset:3}}),/边界/);
  assert.match(wallObjectWarning({...scene,tv:{...patch.tv,wall:'north',centerHeight:1.3}}),/窗户/);
  assert.equal(proposalPatch({tv:{enabled:true,wall:'injected'}},scene).tv,undefined);
});
