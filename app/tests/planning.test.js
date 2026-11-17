import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlanning, restorePlanning, validRooms, requireLayouts } from '../src/planTools.js';
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
