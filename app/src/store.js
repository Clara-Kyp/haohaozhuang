/**
 * 好好装 · 全局状态（Zustand）
 * ------------------------------------------------------------------
 * 相比原版的改动：
 * 1. 材质 / 风格 / 示例数据统一从 data.js 引入，避免两处维护。
 * 2. 新增 paint（墙面试刷色卡）、productId（关联商品）、grid（500mm 网格）字段。
 * 3. 新增 load()：切换房间时载入该房间的场景，不写入撤销栈（原版会把
 *    「换房间」也当成一次编辑，撤销时会出现跨房间串场的问题）。
 * 4. placement() 增加主通道 900mm 净宽校验，提示带上可测量的差值。
 * 5. serializeProject() 保留完整项目，由 IndexedDB 按事务保存。
 */
import { create } from 'zustand';
import { getStyleProfile } from './styleProfiles.js';
import { furnishingWarning,newItem,assets } from './furnishing.js';
import { sanitizeTv, wallObjectWarning } from './wallObjects.js';
import {
  materials, preset, faceNames, ceilingTypes, rugPositions,
  samplePlans, demoProducts, paintSwatches, planBackdrop, heroRoomSvg, buildCourtyardBackdrop,
  interpretCommand, localZones, localPlan,
} from './data.js';

export {
  materials, preset, faceNames, ceilingTypes, rugPositions,
  samplePlans, demoProducts, paintSwatches, planBackdrop, heroRoomSvg, buildCourtyardBackdrop,
  interpretCommand, localZones, localPlan,
};

export const initialRoom = { name: '客厅', x: .12, y: .12, w: .76, h: .76 };

import { initialScene } from './roomScenes.js';
export { initialScene } from './roomScenes.js';

export const useStudio = create((set) => ({
  scene: initialScene,
  undoStack: [],
  confirmed: null,
  roomKey: null,
  roomHistories: {},

  /** 一次用户编辑：记入撤销栈，并使已确认版本失效 */
  edit: (patch) => set(({ scene, undoStack }) => ({
    scene: { ...scene, ...patch, faces: { ...scene.faces, ...(patch.faces || {}) } },
    undoStack: [...undoStack.slice(-29), scene],
    confirmed: null,
  })),

  /** 载入另一房间的场景：切换房间时存取各自的撤销历史 */
  load: (scene, roomKey) => set(state => {
    const histories = { ...state.roomHistories };
    if (state.roomKey != null) histories[state.roomKey] = state.undoStack;
    return {
      scene: { ...initialScene, ...scene, faces: { ...initialScene.faces, ...scene.faces } },
      confirmed: null, roomKey, roomHistories: histories,
      undoStack: roomKey == null ? [] : histories[roomKey] || [],
    };
  }),
  resetProject: () => set({
    scene: initialScene, confirmed: null, undoStack: [], roomHistories: {}, roomKey: null,
  }),

  undo: () => set(({ undoStack }) => undoStack.length
    ? { scene: undoStack.at(-1), undoStack: undoStack.slice(0, -1), confirmed: null }
    : {}),

  confirm: (snapshot) => set({ confirmed: snapshot }),
  clearUndo: () => set({ undoStack: [] }),
}));

/**
 * 把后端 /api/design 返回的 patch 裁剪成允许写入 scene 的字段。
 * 原版已有校验，这里补上 paint（墙面试刷）与产品款式的白名单。
 */
export function proposalPatch(value, scene) {
  const input = value && typeof value === 'object' ? value : {};
  const patch = getStyleProfile(input.style) ? { ...preset(input.style), paint: '' } : {};
  if (ceilingTypes.includes(input.ceiling)) patch.ceiling = input.ceiling;
  if (rugPositions.includes(input.rug)) {
    if(!scene.furnishingApplied)patch.rug=input.rug;
    else {
      const existing=(scene.items||[]).find(i=>assets[i.assetId]?.placement==='rug');
      if(input.rug==='无地毯'){patch.items=(scene.items||[]).filter(i=>assets[i.assetId]?.placement!=='rug'||i.locked);patch.rug='无地毯';}
      else if(!existing||!existing.locked){
        const rest=(scene.items||[]).filter(i=>i.id!==existing?.id),rug=existing?{...existing}:newItem('rug',{...scene,items:rest});
        if(rug){if(input.rug==='靠窗')rug.z=-scene.depth/2+rug.depth/2+.12;
          if(!furnishingWarning([...rest,rug],scene)){patch.items=[...rest,rug];patch.rug='无地毯';}}
      }
    }
  }
  if (typeof input.lamp === 'boolean') patch.lamp = input.lamp;
  if (Number.isFinite(input.tileCm) && input.tileCm >= 30 && input.tileCm <= 120) patch.tileCm = input.tileCm;
  if (typeof input.paint === 'string' && paintSwatches.some(s => s.name === input.paint)) patch.paint = input.paint;
  for (const key of Object.keys(faceNames)) {
    if (Object.hasOwn(materials, input.faces?.[key])) (patch.faces ??= {})[key] = input.faces[key];
  }
  if (!scene.locked && scene.hasSofa !== false) for (const key of ['sofaX', 'sofaZ', 'sofaAngle']) {
    if (Number.isFinite(input[key]) && Math.abs(input[key]) <= 360) patch[key] = input[key];
  }
  if (input.tv) { const tv = sanitizeTv(input.tv, scene.tv); if (tv) patch.tv = tv; }
  return patch;
}

/**
 * 摆位校验：越界、门扇开启范围、主通道净宽。
 * 返回空串表示通过，否则返回带具体数值的中文提示。
 */
export function placement(scene) {
  if(scene.furnishingApplied){const error=furnishingWarning(scene.items||[],scene);if(error)return error;}
  const wallWarning = wallObjectWarning(scene);
  if (wallWarning) return wallWarning;
  if (scene.hasSofa === false) return '';
  const angle = scene.sofaAngle * Math.PI / 180;
  // 旋转后沙发在 x / z 方向的半尺寸（AABB 外接框）
  const halfX = (Math.abs(Math.cos(angle)) * scene.sofaWidth + Math.abs(Math.sin(angle)) * scene.sofaDepth) / 2;
  const halfZ = (Math.abs(Math.sin(angle)) * scene.sofaWidth + Math.abs(Math.cos(angle)) * scene.sofaDepth) / 2;
  const left = scene.sofaX - halfX, right = scene.sofaX + halfX;
  const back = scene.sofaZ - halfZ, front = scene.sofaZ + halfZ;

  if (left < -scene.width / 2 || right > scene.width / 2 || back < -scene.depth / 2 || front > scene.depth / 2) {
    const over = Math.max(
      -scene.width / 2 - left, right - scene.width / 2,
      -scene.depth / 2 - back, front - scene.depth / 2,
    );
    return `沙发超出房间边界约 ${Math.round(over * 100)} cm，请拖回或换小尺寸。`;
  }
  // 入口在右前方，门扇开启区 85cm
  if (front > scene.depth / 2 - .85 && right > scene.width / 2 - 1 && left < scene.width / 2 - .15) {
    return '沙发占用入口门扇开启区（约 85 cm），请向左或向内移动。';
  }
  // 主通道净宽不低于 900mm（沿右侧墙从入口到窗）
  const corridor = scene.width / 2 - right;
  if (corridor < .9 && front > -scene.depth / 2 + .4) {
    return `右侧主通道净宽约 ${Math.round(corridor * 100)} cm，低于 900 mm 参考值。`;
  }
  return '';
}

/** 删除房间后重排索引，保留其余房间场景及按「房间:视图」记录的机位。 */
export function withoutRoom(record, index) {
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
    const match = /^(\d+)(:.*)?$/.exec(key);
    if (!match) return [[key, value]];
    const room = Number(match[1]);
    return room === index ? [] : [[String(room > index ? room - 1 : room) + (match[2] || ''), value]];
  }));
}

/** IndexedDB 按事务保存完整项目，不丢弃原图或生成结果。 */
export function serializeProject(data) {
  return { ...data, schemaVersion: 2, savedAt: new Date().toISOString() };
}
