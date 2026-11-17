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
