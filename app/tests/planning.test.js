import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlanning, restorePlanning, validRooms, requireLayouts, recognitionRoomSizes, applyRecognitionSizes,
  dragPlanRoom, resizeRoomToDimensions } from '../src/planTools.js';
import { readProject, writeProject } from '../src/persistence.js';

test('旧户型草稿默认采用保留原布局，仍保留历史候选和预览', () => {
  const layouts = [{ id:'old', style:'侘寂' }];
  const draft = restorePlanning({ stylesText:'侘寂', appliedStyle:'侘寂', layouts, previewId:'old' });
  assert.deepEqual(draft.goals, ['preserve']);
  assert.equal(draft.layouts, layouts);
  assert.equal(draft.previewId, 'old');
  assert.equal(draft.appliedStyle, undefined);
  assert.deepEqual(restorePlanning({ goals:['storage'] }).goals, ['storage']);
});

test('非模型响应、缺少方案或越界候选不能写入现有布局', () => {
  const room = { name:'客厅', x:0, y:0, w:.8, h:.7 };
  const plan = { id:'candidate', goal:'preserve', rooms:[room], circulation:{summary:'动线待核实'} };
  assert.equal(validRooms([room]), true);
  assert.equal(validRooms([{...room,x:.7}]), false);
  assert.equal(validRooms([]), false);
  const response = { source:'model', layouts:[plan] };
  assert.deepEqual(requireLayouts(response,['preserve']),[plan]);
  assert.throws(() => requireLayouts({...response,source:'demo'},['preserve']));
  assert.throws(() => requireLayouts(response,['preserve','circulation']));
});

test('户型规划草稿保存保留原图、用户提示词、参考图、候选及预览状态', async () => {
  const project = { photo:'data:image/png;base64,source', planning:{ ...newPlanning(),
    instruction:'不要穿过卧室进入后院', references:[{id:'ref',label:'意式',image:'data:image/jpeg;base64,ref'}],
    layouts:[{id:'plan-a',style:'意式',rooms:[{name:'客厅',x:0,y:0,w:.5,h:.5}]}], previewId:'plan-a',
  }, stage:'plan' };
  await writeProject(project);
  assert.deepEqual(await readProject(), project);
});

test('房间尺寸条件只写入名称唯一匹配的识别结果', () => {
  const sizes = recognitionRoomSizes([{ name: '卧室 A', width: '3.2', depth: '4.1' }]);
  const room = { name: '卧室A', x: .1, y: .1, w: .3, h: .4 };
  assert.deepEqual(applyRecognitionSizes([room], sizes)[0].size, [3.2, 4.1]);
  assert.deepEqual(applyRecognitionSizes([room, room], sizes), [room, room]);
  assert.throws(() => recognitionRoomSizes([{ name: '卧室', width: '3.2', depth: '' }]), /宽度和进深/);
});

test('移动不改变房间长宽，边和角的调整保留对边且不能越界', () => {
  const room = { name: '客厅', x: .125, y: .125, w: .25, h: .25, size: [4, 3] };
  const scale = [10, 10];
  const moved = dragPlanRoom(room, 'move', { x: .8, y: -.2 }, scale);
  assert.deepEqual([moved.x, moved.y, moved.w, moved.h, moved.size], [.75, 0, .25, .25, [4, 3]]);
  const resized = dragPlanRoom(room, 'nw', { x: -.125, y: .125 }, scale);
  assert.deepEqual([resized.x, resized.y, resized.w, resized.h, resized.size], [0, .25, .375, .125, [6, 1.5]]);
  assert.deepEqual(resizeRoomToDimensions(room, [6, 4.5], scale).size, [6, 4.5]);
  assert.throws(() => resizeRoomToDimensions(room, [60, 4.5], scale), /超出底图/);
});

test('房间边界在吸附容差内对齐，相邻边界不影响另一轴', () => {
  const room = { name: '客厅', x: .125, y: .125, w: .25, h: .25 };
  const neighbor = { x: .5, y: .6, w: .25, h: .2 };
  const result = dragPlanRoom(room, 'e', { x: .13, y: .01 }, [10, 10], [neighbor], [.02, .02]);
  assert.deepEqual([result.x, result.y, result.w, result.h], [.125, .125, .375, .25]);
});
