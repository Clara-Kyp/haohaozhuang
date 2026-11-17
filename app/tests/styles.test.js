import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleNames, canonicalStyle, getStyleProfile } from '../src/styleProfiles.js';
import { faceNames, interpretCommand, materials, preset } from '../src/data.js';
import { assets } from '../src/furnishing.js';
import { initialScene, proposalPatch } from '../src/store.js';
import { showroomSnapshot, restoreShowroom } from '../src/buildTools.js';

test('12 个不同的六面预设均可渲染并引用真实目录资产', () => {
  assert.equal(styleNames.length, 12);
  const faces = new Set();
  for (const name of styleNames) {
    const settings = preset(name);
    assert.equal(settings.style, name);
    assert.deepEqual(Object.keys(settings.faces), Object.keys(faceNames));
    assert.ok(Object.values(settings.faces).every(material => Object.hasOwn(materials, material)), name);
    assert.ok(getStyleProfile(name).preferredAssets.every(id => assets[id]), name);
    faces.add(JSON.stringify(settings.faces));
  }
  assert.equal(faces.size, 12);
});

test('别名兼容且侘寂、混凝土、中古和中世纪可区分', () => {
  for (const [command, name] of [
    ['帮我换成侘寂风', '侘寂'],
    ['切换为混凝土风', '工业混凝土'],
    ['选中古现代风', '中古现代'],
    ['换成欧洲中世纪风', '欧洲中世纪'],
  ]) {
    assert.equal(interpretCommand(command).patch.style, name);
  }
  assert.equal(interpretCommand('地面用浅灰微水泥').patch.style, undefined);
  assert.equal(canonicalStyle('极简风'), '现代极简');
  assert.equal(proposalPatch({style: '极简风'}, initialScene).style, '现代极简');
});

test('恢复样板间时材质和风格一起恢复', () => {
  const sample = {...initialScene, ...preset('包豪斯')};
  const next = {...sample, ...preset('法式轻复古'), showroom: showroomSnapshot(sample)};
  const restored = restoreShowroom(next);
  assert.equal(restored.style, '包豪斯');
  assert.deepEqual(restored.faces, sample.faces);
});
