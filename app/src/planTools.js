export const layoutGoals = {
  preserve: { label: '保留原布局', description: '尽量保留现有分隔、墙体和门窗' },
  circulation: { label: '优先改善动线', description: '理顺出入口、过道和房间之间的通行' },
  storage: { label: '增加收纳', description: '优先在玄关或走廊预留柜体位置' },
};
export const exampleLayoutPrompt = '保留卧室私密性，卧室不作为过道。保证前后院能直接通行，尽量保留现有墙体和门窗。玄关如有余量，可以预留鞋柜位置。';
export const newPlanning = () => ({
  instruction: '', goals: ['preserve'], references: [], layouts: [],
  previewId: null, appliedId: null, error: '', generationId: null, model: '',
});

export function restorePlanning(saved = {}) {
  const { stylesText, appliedStyle, ...draft } = saved;
  return { ...newPlanning(), ...draft };
}

export function validRooms(input) {
  return Array.isArray(input) && input.length > 0 && input.length <= 24 && input.every(r => r &&
    typeof r.name === 'string' && r.name.trim() && [r.x, r.y, r.w, r.h].every(Number.isFinite) &&
    r.x >= 0 && r.y >= 0 && r.w > .025 && r.h > .025 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001);
}

export const MAX_PLAN_ROOMS = 24;
export const MIN_ROOM_SPAN = .026;
export const PLAN_VIEW_WIDTH = 1000;
export const DEFAULT_PLAN_WIDTH = 6.32;
export const PLAN_SCALE_PIXELS = 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validDimension = value => Number.isFinite(value) && value >= 1 && value <= 60;
const roomNameKey = name => name.trim().replace(/\s+/g, '').toLowerCase();

export function recognitionRoomSizes(rows) {
  const sizes = [];
  const names = new Set();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && row.width === '' && row.depth === '') continue;
    const width_m = Number(row.width);
    const depth_m = Number(row.depth);
    if (!name || !validDimension(width_m) || !validDimension(depth_m)) {
      throw new Error('请填写房间名称，以及 1–60 米的宽度和进深。');
    }
    const key = roomNameKey(name);
    if (names.has(key)) throw new Error('请用不同的房间名称，例如「主卧」和「次卧」。');
    names.add(key);
    sizes.push({ name, width_m, depth_m });
  }
  return sizes;
}

export function applyRecognitionSizes(rooms, sizes) {
  const counts = new Map();
  for (const room of rooms) {
    const key = roomNameKey(room.name);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rooms.map(room => {
    const key = roomNameKey(room.name);
    const size = sizes.find(entry => roomNameKey(entry.name) === key);
    return size && counts.get(key) === 1 ? { ...room, size: [size.width_m, size.depth_m] } : room;
  });
}

export function planRoomDimensions(room, [width, depth]) {
  return room?.size || [Math.max(1.5, width * (room?.w || .5)), Math.max(1.5, depth * (room?.h || .5))];
}

export function scaleForPlanWidth(width, pixels) {
  return width * PLAN_SCALE_PIXELS / pixels;
}

export function planDimensionsAtScale(scale, pixels, ratio) {
  const width = scale * pixels / PLAN_SCALE_PIXELS;
  return [width, width / ratio];
}

export function scalePlanRooms(rooms, planSize, factor) {
  return rooms.map(room => ({ ...room, size: planRoomDimensions(room, planSize).map(value => value * factor) }));
}

export function restorePlanScale(saved) {
  const width = saved.planW || DEFAULT_PLAN_WIDTH;
  const ratio = saved.ratio || 1;
  const pixels = saved.photo ? (saved.planImg?.[0] || 2048) : PLAN_VIEW_WIDTH;
  const legacy = !Number.isFinite(saved.planScale) || saved.planScale <= 0;
  const scale = legacy ? scaleForPlanWidth(width, pixels) : saved.planScale;
  const oldSize = [width, saved.planH || DEFAULT_PLAN_WIDTH];
  const dimensions = planDimensionsAtScale(scale, pixels, ratio);
  const restoreRooms = rooms => {
    if (!legacy) return rooms || [];
    return (rooms || []).map(room => room.size ? room : { ...room, size: planRoomDimensions(room, oldSize) });
  };
  return { scale, dimensions, rooms: restoreRooms(saved.rooms), source: restoreRooms(saved.source),
    verified: !!saved.verified && (!legacy || Math.abs(oldSize[1] - dimensions[1]) < .01) };
}

export function resizeRoomToDimensions(room, size, planSize) {
  if (!size.every(validDimension)) throw new Error('房间宽度和进深须在 1–60 米之间。');
  const [width, depth] = planRoomDimensions(room, planSize);
  const w = room.w * size[0] / width;
  const h = room.h * size[1] / depth;
  if (w < MIN_ROOM_SPAN || h < MIN_ROOM_SPAN || room.x + w > 1 + 1e-8 || room.y + h > 1 + 1e-8) {
    throw new Error('该尺寸在当前比例下会超出底图或难以绘制。请先移动房间或核对图纸比例。');
  }
  return { ...room, w: Math.min(w, 1 - room.x), h: Math.min(h, 1 - room.y), size };
}

function snapDelta(edges, targets, tolerance) {
  let delta = 0;
  let distance = tolerance;
  for (const edge of edges) {
    for (const target of targets) {
      if (Math.abs(target - edge) >= distance) continue;
      delta = target - edge;
      distance = Math.abs(delta);
    }
  }
  return delta;
}

function editRoomAxis(start, span, delta, moveStart, moveEnd, size, targets, tolerance) {
  const end = start + span;
  if (moveStart && moveEnd) {
    const position = start + delta;
    return [clamp(position + snapDelta([position, position + span], targets, tolerance), 0, 1 - span), span];
  }
  const min = Math.min(span, Math.max(MIN_ROOM_SPAN, span / size));
  const max = Math.max(span, span * 60 / size);
  if (moveStart) {
    const position = start + delta;
    const next = clamp(position + snapDelta([position], targets, tolerance), Math.max(0, end - max), end - min);
    return [next, end - next];
  }
  if (moveEnd) {
    const position = end + delta;
    return [start, clamp(position + snapDelta([position], targets, tolerance) - start, min, Math.min(max, 1 - start))];
  }
  return [start, span];
}

export function dragPlanRoom(room, handle, delta, planSize, neighbors = [], tolerance = [0, 0]) {
  const [width, depth] = planRoomDimensions(room, planSize);
  const moving = handle === 'move';
  const [x, w] = editRoomAxis(room.x, room.w, delta.x, moving || handle.includes('w'), moving || handle.includes('e'),
    width, [0, 1, ...neighbors.flatMap(other => [other.x, other.x + other.w])], tolerance[0]);
  const [y, h] = editRoomAxis(room.y, room.h, delta.y, moving || handle.includes('n'), moving || handle.includes('s'),
    depth, [0, 1, ...neighbors.flatMap(other => [other.y, other.y + other.h])], tolerance[1]);
  const next = { ...room, x, y, w, h };
  if (!moving && room.size) next.size = [width * w / room.w, depth * h / room.h];
  return next;
}

export function requireLayouts(value, goals) {
  const layouts = value?.layouts;
  if (value?.source !== 'model' || !Array.isArray(layouts) || layouts.length !== goals.length ||
      !goals.every(goal => layouts.some(plan => plan?.goal === goal)) ||
      layouts.some(p => typeof p?.id !== 'string' || !validRooms(p.rooms) || !p.circulation?.summary)) {
    throw new Error('未收到完整的模型布局方案，现有布局已保留，请重试。');
  }
  return layouts;
}

export async function readImage(file, maxSide = 0) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12_000_000) {
    throw new Error('请选择 12 MB 内的 PNG、JPG 或 WebP。');
  }
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = source; await image.decode();
  if (!maxSide) return { image: source, width: image.width, height: image.height };
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL('image/jpeg', .88), width: canvas.width, height: canvas.height };
}

export async function rasterizePlan(svg) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.nodeName !== 'svg') throw new Error('没有可用于规划的底图，请先上传户型。');
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
  const ratio = viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : 1;
  root.setAttribute('width', '1400'); root.setAttribute('height', String(Math.round(1400 / ratio)));
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
  await image.decode();
  const canvas = window.document.createElement('canvas'); canvas.width = 1400; canvas.height = Math.round(1400 / ratio);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
