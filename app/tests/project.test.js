import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useStudio, initialScene, serializeProject, withoutRoom } from '../src/store.js';
import { createRoomScene } from '../src/roomScenes.js';
import { readProject, writeProject } from '../src/persistence.js';

test('撤销在房间之间隔离，返回原房间后恢复该房间历史', () => {
  const state = () => useStudio.getState();
  state().resetProject();
  state().load({ ...initialScene, width: 4.8 }, 0);
  state().edit({ style: '混凝土风' });
  state().load({ ...initialScene, width: 3.1 }, 1);
  state().undo();
  assert.equal(state().scene.width, 3.1);
  state().edit({ lamp: true });
  state().load({ ...initialScene, width: 4.8, style: '混凝土风' }, 0);
  state().undo();
  assert.equal(state().scene.style, initialScene.style);
  state().load({ ...initialScene, width: 3.1, lamp: true }, 1);
  state().undo();
  assert.equal(state().scene.lamp, false);
  state().resetProject();
  assert.equal(state().undoStack.length, 0);
  assert.deepEqual(state().roomHistories, {});
});

test('完整存档往返保留大图、底图、多个房间、机位和任务', async () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(500000);
  const project = serializeProject({
    rooms: [{ name: '客厅' }, { name: '卧室' }], active: 1, photo: image,
    planImg: [2000, 1500], roomScenes: {
      0: { ...initialScene, sofaWidth: 2.4 },
      1: { ...initialScene, lamp: true },
    },
    cameraPoses: { '1:inside': { position: [1, 2, 3], target: [0, 1, 0] } },
    results: [{ version: 1, image, baseline: image }],
    job: { id: 'pending-job', started: Date.now() },
  });
  await writeProject(project);
  const saved = await readProject();
  assert.deepEqual(saved, project);
  saved.roomScenes[0].sofaWidth = 1;
  assert.equal((await readProject()).roomScenes[0].sofaWidth, 2.4);
});

test('删除房间只移除该房间，其他房间和机位随索引重排', () => {
  assert.deepEqual(withoutRoom({ 0: 'living', 1: 'deleted', 2: 'bedroom' }, 1), {
    0: 'living', 1: 'bedroom',
  });
  assert.deepEqual(withoutRoom({ '0:inside': [1], '1:top': [2], '2:inside': [3] }, 1), {
    '0:inside': [1], '1:inside': [3],
  });
});

test('房间用途、独立陈设与墙挂电视完整保存恢复', async () => {
  const living = createRoomScene({name:'客厅'},[5,4]);
  living.tv={enabled:true,wall:'east',centerHeight:.6,width:1.2,height:.68,offset:0};
  const kitchen = createRoomScene({name:'厨房'},[2,3]);
  const project=serializeProject({rooms:[{name:'客厅'},{name:'厨房'}],roomScenes:{0:living,1:kitchen}});
  await writeProject(project);const saved=await readProject();
  assert.deepEqual(saved.roomScenes[0].tv,living.tv);
  assert.equal(saved.roomScenes[1].hasSofa,false);
  assert.deepEqual(saved.roomScenes[1].furniture,kitchen.furniture);
});
