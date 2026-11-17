import { preset } from './data.js';
import { defaultTv } from './wallObjects.js';
import {showroomSnapshot} from './buildTools.js';

export const roomTypes = {
  living: '客厅', bedroom: '卧室', kitchen: '厨房', bath: '卫生间',
  dining: '餐厅', study: '书房', circulation: '玄关 / 过道', court: '庭院 / 阳台', other: '未确定用途',
};

export function classifyRoom(room = {}) {
  if (room.kindConfirmed && Object.hasOwn(roomTypes, room.kind)) return room.kind;
  if (Object.hasOwn(roomTypes, room.kind) && room.kind !== 'other') return room.kind;
  const name = String(room.name || '');
  if (/卫生|洗手|浴|盥洗|干区/.test(name)) return 'bath';
  if (/厨房|餐厨|厨餐/.test(name)) return 'kitchen';
  if (/卧|睡眠|休息/.test(name)) return 'bedroom';
  if (/书房|工作|办公|阅读/.test(name)) return 'study';
  if (/餐厅|用餐/.test(name)) return 'dining';
  if (/玄关|过道|走廊|分配廊|通道/.test(name)) return 'circulation';
  if (/庭院|前院|后院|阳台|露台/.test(name)) return 'court';
  if (/客厅|起居|会客|偏厅/.test(name)) return 'living';
  return 'other';
}

export const initialScene = {
  ...preset('奶油风'), ceiling: '无吊顶', drop: .15, band: .30, tileCm: 80, rug: '无地毯', lamp: false,
  sofaX: -1.55, sofaZ: 0, sofaAngle: 90, sofaWidth: 2.15, sofaDepth: .88, sofaHeight: .88,
  sofaColor: '#d9a07b', locked: false, link: '', productId: 'sofa-1', paint: '', grid: false,
  width: 4.8, depth: 3.7, height: 2.75, roomType: 'living', roomName: '客厅', hasSofa: true,
  furniture: [], furnishingApplied:false, items:[], sceneVersion: 3, tv: { ...defaultTv },
};

/** 基础陈设是可核对的示意物件；不把识别房间假装成模型自动完成装修。 */
export function createRoomScene(room, [width, depth], saved) {
  const roomType = classifyRoom(room);
  const base = { ...initialScene, faces: { ...initialScene.faces }, roomType, roomName: room.name,
    width, depth, hasSofa: roomType === 'living' && width >= 1.8 && depth >= 2,
    furniture: [], productId: roomType === 'living' ? 'sofa-1' : '',
    sofaX: -width / 2 + .59, sofaWidth: Math.min(2.15, depth - .55),
  };
  const fixture = (kind, name, x, z, w, d, h) => ({ id: kind, kind, name, x, z, width: w, depth: d, height: h });
  if (roomType === 'bedroom') {
    base.furniture = [fixture('bed', '床与床品', -.06 * width, 0, Math.min(1.6, width - .6), Math.min(2, depth - .5), .52),
      fixture('wardrobe', '衣柜', width / 2 - .3, -depth / 2 + .7, .55, Math.min(1.2, depth - .6), Math.min(2.25, base.height - .2))];
  } else if (roomType === 'kitchen') {
    base.faces = { ...base.faces, floor: '浅灰哑光砖', north: '暖白乳胶漆', south: '暖白乳胶漆', east: '暖白乳胶漆', west: '暖白乳胶漆' };
    base.furniture = [fixture('kitchen', '橱柜、灶台与水槽', -.35, -depth / 2 + .34, Math.max(.75, width - .95), .6, .88),
      fixture('fridge', '冰箱', width / 2 - .35, -depth / 2 + .36, .6, .64, Math.min(1.85, base.height - .3))];
  } else if (roomType === 'bath') {
    base.faces = { ...base.faces, floor: '浅灰哑光砖', north: '暖灰亮面砖', south: '暖灰亮面砖', east: '暖灰亮面砖', west: '暖灰亮面砖' };
    base.tileCm = 60;
    base.furniture = [fixture('vanity', '洗手台与镜子', -width * .2, -depth / 2 + .3, Math.min(.95, width * .43), .48, .83),
      fixture('toilet', '坐便器', width / 2 - .36, -depth * .05, .4, .66, .78),
      fixture('shower', '淋浴区', -width / 2 + .48, depth / 2 - .5, Math.min(.85, width * .4), .85, 2)];
  } else if (roomType === 'study') {
    base.furniture = [fixture('desk', '书桌与座椅', 0, -depth / 2 + .5, Math.min(1.4, width - .4), .65, .76),
      fixture('bookshelf', '书架', -width / 2 + .2, depth / 2 - .6, .35, Math.min(1.1, depth - .5), 1.9)];
  } else if (roomType === 'dining') {
    base.furniture = [fixture('dining', '餐桌与餐椅', 0, 0, Math.min(1.4, width - .65), Math.min(.8, depth - .65), .75)];
  } else if (roomType === 'circulation') {
    base.furniture = [fixture('console', '玄关收纳柜', -width / 2 + .18, 0, .3, Math.min(1, depth - .5), .95)];
  }
  if (!saved) return base;
  if (saved.sceneVersion === 3 && saved.roomType === roomType) {
    return { ...base, ...saved, showroom:saved.showroom||(saved.furnishingApplied?showroomSnapshot(saved):null),roomName: room.name, width, depth, faces: { ...base.faces, ...saved.faces } };
  }
  // 老版所有房间的隐式沙发是模板错误；用户显式关联的沙发仍保留。
  const explicitSofa = saved.sofaExplicit === true || !!saved.link;
  const standardFaces = preset(saved.style || '奶油风').faces;
  // 旧版用这两组默认值，迁移时仍以当时的预设区分手工改动。
  if (saved.style === '极简风') standardFaces.floor = '暖灰亮面砖';
  if (saved.style === '混凝土风') standardFaces.ceiling = '灰色微水泥';
  const faces = { ...base.faces };
  for (const [face, material] of Object.entries(saved.faces || {})) {
    if (material !== standardFaces[face]) faces[face] = material;
  }
  return { ...base, ...saved, roomType, roomName: room.name, width, depth, faces, sceneVersion: 3,
    furnishingApplied:false, items:[], furniture: base.furniture, hasSofa: base.hasSofa || explicitSofa,
    rug: roomType === 'bath' || roomType === 'kitchen' ? '无地毯' : saved.rug || '无地毯',
    lamp: ['living', 'bedroom', 'study'].includes(roomType) ? !!saved.lamp : false,
  };
}
