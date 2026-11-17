/**
 * 好好装 · 内置演示数据与本地规则引擎
 * ------------------------------------------------------------------
 * 设计目的：
 * 1. 让作品在没有 API Key、Redis、ComfyUI 的情况下也能完整跑通主流程。
 * 2. 所有户型、商品均为「演示数据」，界面上会明确标注，不冒充真实商品信息。
 * 3. 中文指令解析放在前端，后端 /api/design 不可用时自动降级到这里的规则引擎。
 *
 * 说明：本文件不依赖 React / Three.js，可同时被开发版与单文件演示版复用。
 */

import { getStyleProfile, styleFromText } from './styleProfiles.js';

/* ---------------------------------------------------------------- 材质与风格 */

/** 饰面名称 → 颜色。与后端 PALETTE 提示词保持一致，避免 AI 返回无效值。 */
export const materials = {
  暖白乳胶漆: '#efe7d9', 米色艺术涂料: '#ddc7a9', 深木饰面: '#6d4c3b', 灰色微水泥: '#a5a29b',
  粗石: '#8a7b68', 浅灰哑光砖: '#b6b4ac', 暖灰亮面砖: '#c6bfb1', 橡木地板: '#c39a6d',
  暖灰艺术涂料: '#c6b7a3', 浅橡木地板: '#e1c5a1', 米白乳胶漆: '#dfd4c2',
  胡桃木地板: '#8e684c', 暖灰哑光砖: '#bdb4a4',
};

export const faceNames = {
  ceiling: '天花', floor: '地面', north: '窗墙', south: '入口墙', west: '左侧墙', east: '右侧墙',
};
export const ceilingTypes = ['无吊顶', '平吊顶', '双眼皮吊顶'];
export const rugPositions = ['无地毯', '沙发前', '茶几下', '靠窗'];

/** 根据风格生成一份可合并进 scene 的 patch */
export function preset(style) {
  const profile = getStyleProfile(style);
  const { materials: [ceiling, floor, wall], faces } = profile || getStyleProfile('奶油风');
  return {
    style: profile?.name ?? style,
    faces: { ceiling, floor, north: wall, south: wall, west: wall, east: wall, ...faces },
  };
}

/* ---------------------------------------------------------------- 内置示例户型 */

/**
 * 示例户型 A 参考工作区那张户型图（厨房 4.2㎡ / 卧室A 10.2㎡ / 客厅 26.4㎡ /
 * 卫生间 6.9㎡ / 卧室B 13.0㎡）。矩形为图上的归一化位置，size 是按标注面积
 * 换算的「示意尺寸」，实际项目仍应以实测尺寸校准。
 */
export const samplePlan = {
  id: 'plan-a',
  name: '两室一厅 · 竖厅',
  subtitle: '约 70㎡ · 南北通透 · 5 个空间',
  planWidthM: 5.76,
  planHeightM: 12.4,
  ratio: 1000 / 1000,
  rooms: [
    { name: '厨房', x: .355, y: .09, w: .095, h: .30, area: 4.2, size: [1.85, 2.27], kind: 'kitchen' },
    { name: '卧室A', x: .45, y: .155, w: .15, h: .235, area: 10.2, size: [2.85, 3.58], kind: 'bedroom' },
    { name: '客厅', x: .355, y: .39, w: .295, h: .24, area: 26.4, size: [5.76, 4.58], kind: 'living' },
    { name: '卫生间', x: .355, y: .63, w: .085, h: .28, area: 6.9, size: [2.30, 3.00], kind: 'bath' },
    { name: '卧室B', x: .44, y: .63, w: .16, h: .28, area: 13.0, size: [3.06, 4.25], kind: 'bedroom' },
  ],
};

/** 示例户型 B：文章里提到的带前后院小户型，用于展示「调整布局」分支 */
export const courtyardPlan = {
  id: 'plan-b',
  name: '带前后院 · 小户型',
  subtitle: '约 70㎡ · 毛坯 · 自由分割',
  planWidthM: 8.4,
  planHeightM: 9.0,
  ratio: 1,
  rooms: [
    { name: '前院', x: .08, y: .06, w: .84, h: .18, area: 12.0, size: [7.1, 1.7], kind: 'court' },
    { name: '客餐厅', x: .08, y: .24, w: .50, h: .40, area: 27.0, size: [4.2, 6.4], kind: 'living' },
    { name: '书房', x: .58, y: .24, w: .34, h: .24, area: 9.5, size: [2.9, 3.3], kind: 'study' },
    { name: '厨房', x: .58, y: .48, w: .34, h: .16, area: 6.4, size: [2.9, 2.2], kind: 'kitchen' },
    { name: '主卧', x: .08, y: .64, w: .44, h: .26, area: 13.6, size: [3.7, 3.7], kind: 'bedroom' },
    { name: '卫浴', x: .52, y: .64, w: .22, h: .26, area: 5.6, size: [1.9, 3.0], kind: 'bath' },
    { name: '后院', x: .74, y: .64, w: .18, h: .26, area: 8.0, size: [1.6, 5.0], kind: 'court' },
  ],
};

export const samplePlans = [samplePlan, courtyardPlan];

/**
 * 内置户型底图（SVG 字符串）。零外部图片依赖，单文件演示版也能直接显示。
 * 只画示意墙线、木地板填充和尺寸标注，不做精确测绘。
 */
export const planBackdrop = `
<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <pattern id="wood" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
      <rect width="26" height="26" fill="#fbf1dc"/>
      <path d="M0 6h26M0 19h26" stroke="#efdcbb" stroke-width="1"/>
      <path d="M13 0v6M6 6v13M20 19v7" stroke="#f0dfc0" stroke-width="1"/>
    </pattern>
    <pattern id="tile" width="22" height="22" patternUnits="userSpaceOnUse">
      <rect width="22" height="22" fill="#f4f5f2"/>
      <path d="M0 0h22v22" fill="none" stroke="#e2e6e1" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1000" height="1000" fill="#ffffff"/>
  <g stroke="#cfd4cd" stroke-width="1" fill="none" opacity=".65">
    <path d="M280 60v880M720 60v880M60 200h880M60 800h880" stroke-dasharray="6 10"/>
  </g>
  <!-- 房间地面 -->
  <rect x="355" y="90" width="95" height="300" fill="url(#tile)"/>
  <rect x="450" y="155" width="150" height="235" fill="url(#wood)"/>
  <rect x="355" y="390" width="295" height="240" fill="url(#wood)"/>
  <rect x="355" y="630" width="85" height="280" fill="url(#tile)"/>
  <rect x="440" y="630" width="160" height="280" fill="url(#wood)"/>
  <!-- 墙体外轮廓 -->
  <g fill="#2f3a33" stroke="#2f3a33" stroke-linejoin="miter">
    <path d="M345 80h120v70h155v-25h35v265h45v240h-50v280h-10v20H470v-20H345v-280h0V375h0V80z" opacity=".92"/>
  </g>
  <!-- 挖空（用白色覆盖形成房间） -->
  <g fill="#ffffff">
    <rect x="355" y="90" width="95" height="300"/>
    <rect x="450" y="155" width="150" height="235"/>
    <rect x="355" y="390" width="295" height="240"/>
    <rect x="355" y="630" width="85" height="280"/>
    <rect x="440" y="630" width="160" height="280"/>
  </g>
  <g fill="url(#wood)">
    <rect x="450" y="155" width="150" height="235"/>
    <rect x="355" y="390" width="295" height="240"/>
    <rect x="440" y="630" width="160" height="280"/>
  </g>
  <g fill="url(#tile)">
    <rect x="355" y="90" width="95" height="300"/>
    <rect x="355" y="630" width="85" height="280"/>
  </g>
  <!-- 墙线 -->
  <g stroke="#2f3a33" stroke-width="9" fill="none">
    <path d="M350 85h115v65h155v-25h35v265h50v240h-55v285h-10v15H470v-15H350z"/>
    <path d="M350 375h100M450 375h0M350 625h100M440 625h165M355 390h-5M355 630h-5"/>
  </g>
  <!-- 门洞与门扇 -->
  <g stroke="#9aa79b" stroke-width="2" fill="none">
    <path d="M355 375a55 55 0 0 1 55 55M440 630a55 55 0 0 0 55-55M440 385a45 45 0 0 0 45 45" stroke-dasharray="7 5"/>
  </g>
  <!-- 窗 -->
  <g stroke="#7fb8c9" stroke-width="6">
    <path d="M380 85h65M470 150h110M470 910h100M645 470v90"/>
  </g>
  <!-- 家具俯视示意 -->
  <g opacity=".8">
    <rect x="495" y="175" width="95" height="45" rx="4" fill="#b9a081"/><rect x="500" y="178" width="85" height="12" rx="3" fill="#8d775d"/>
    <rect x="470" y="405" width="110" height="42" rx="5" fill="#d9c6a7"/><rect x="485" y="465" width="70" height="45" rx="4" fill="#e5d6bd"/>
    <rect x="495" y="780" width="95" height="45" rx="4" fill="#b9a081"/><rect x="500" y="783" width="85" height="12" rx="3" fill="#8d775d"/>
    <rect x="370" y="740" width="45" height="30" rx="4" fill="#ffffff" stroke="#cfd4cd"/>
    <rect x="368" y="110" width="70" height="24" rx="2" fill="#eef1ec" stroke="#cfd4cd"/>
  </g>
  <!-- 尺寸标注 -->
  <g fill="#98a29a" font-size="15" font-family="system-ui, sans-serif" text-anchor="middle">
    <text x="447" y="42">1847</text><text x="592" y="42">2846</text><text x="670" y="42">1070</text>
    <text x="425" y="952">1613</text><text x="578" y="952">3060</text><text x="655" y="952">1090</text>
  </g>
  <g stroke="#c9cec7" stroke-width="1.5"><path d="M355 55h295M355 935h295"/></g>
</svg>`;

/* ---------------------------------------------------------------- 演示商品 */

/**
 * 演示商品数据。全部标记为「演示」，避免被误读为真实在售商品。
 * kind 用于筛选当前选中对象可以替换的品类。
 */
export const demoProducts = [
  {
    id: 'sofa-1', kind: 'sofa', name: '云朵三人位布艺沙发', tag: '同款', price: 2680,
    size: [2.15, .88, .88], color: '#d9a07b', brand: '演示品牌 A',
    note: '宽 215 × 深 88 × 高 88 cm · 规格待核实',
  },
  {
    id: 'sofa-2', kind: 'sofa', name: '窄厅直排模块沙发', tag: '相似款', price: 3190,
    size: [1.90, .90, .82], color: '#a8c3ae', brand: '演示品牌 B',
    note: '宽 190 × 深 90 × 高 82 cm · 适合窄厅',
  },
  {
    id: 'sofa-3', kind: 'sofa', name: '焦糖色皮质三人位', tag: '相似款', price: 4280,
    size: [2.40, .95, .86], color: '#b5764c', brand: '演示品牌 C',
    note: '宽 240 × 深 95 × 高 86 cm · 需复核通道净宽',
  },
  {
    id: 'rug-1', kind: 'rug', name: '短绒米白地毯', tag: '仅关联链接', price: 499,
    size: [1.6, 2.3, .03], color: '#e7dcc7', brand: '演示品牌 D', note: '160 × 230 cm',
  },
  {
    id: 'rug-2', kind: 'rug', name: '低饱和绿编织地毯', tag: '相似款', price: 629,
    size: [1.4, 2.0, .03], color: '#b9cfbc', brand: '演示品牌 E', note: '140 × 200 cm',
  },
  {
    id: 'lamp-1', kind: 'lamp', name: '暖光落地灯', tag: '同款', price: 359,
    size: [.38, 1.45, .38], color: '#ecc98f', brand: '演示品牌 F', note: '暖光 3000K',
  },
];

/** 墙面试刷色卡（演示数据，非真实色号） */
export const paintSwatches = [
  { name: '雾粉', color: '#f2cfd9', code: 'DEMO-P01' },
  { name: '鼠尾草', color: '#bcd3bd', code: 'DEMO-G02' },
  { name: '燕麦白', color: '#efe6d6', code: 'DEMO-W03' },
  { name: '浅陶土', color: '#e6bd9c', code: 'DEMO-O04' },
  { name: '雾青', color: '#bcd8d8', code: 'DEMO-C05' },
];

/* ---------------------------------------------------------------- 中文指令规则引擎 */

const firstMatch = (text, pairs) => {
  for (const [keys, value] of pairs) {
    if (keys.some(key => text.includes(key))) return value;
  }
  return null;
};

/**
 * 把一句日常中文装修需求翻译成可应用的 scene patch。
 * 后端不可用时由前端调用；后端可用时仍以后端 /api/design 结果为准。
 * @param {string} text 用户输入
 * @param {object} scene 当前场景（用于遵守锁定项）
 * @returns {{patch: object, summary: string}}
 */
export function interpretCommand(text, scene = {}) {
  const input = String(text || '').trim();
  if (!input) return { patch: {}, summary: '请先描述你想改动的地方。' };
  const patch = {};
  const notes = [];

  // 1) 风格
  const style = styleFromText(input);
  if (style) { Object.assign(patch, preset(style)); notes.push(`切换为${style}`); }

  // 2) 吊顶
  const ceiling = firstMatch(input, [
    [['双眼皮'], '双眼皮吊顶'], [['平吊顶', '平吊'], '平吊顶'], [['无吊顶', '不要吊顶', '取消吊顶'], '无吊顶'],
  ]);
  if (ceiling) { patch.ceiling = ceiling; notes.push(ceiling); }

  // 3) 地面与砖规格
  const floor = firstMatch(input, [
    [['浅灰哑光', '哑光砖'], '浅灰哑光砖'], [['亮面砖', '暖灰亮面'], '暖灰亮面砖'],
    [['木地板', '橡木'], '橡木地板'], [['微水泥', '水泥地'], '灰色微水泥'],
  ]);
  if (floor) { patch.faces = { ...(patch.faces || {}), floor }; notes.push(`地面改为${floor}`); }
  const tile = input.match(/(\d{2,3})\s*(?:cm|厘米|公分|mm|毫米)?\s*(?:方)?砖/);
  if (tile) {
    let cm = Number(tile[1]);
    if (cm > 120 && cm <= 1200) cm = Math.round(cm / 10); // 800mm → 80cm
    if (cm >= 30 && cm <= 120) { patch.tileCm = cm; notes.push(`方砖 ${cm} cm`); }
  }
  if (input.includes('砖') && !patch.faces?.floor) {
    patch.faces = { ...(patch.faces || {}), floor: '浅灰哑光砖' };
  }

  // 4) 墙面试刷（口语颜色 → 最接近的演示色卡）
  const paint = firstMatch(input, [
    [['粉'], '雾粉'], [['绿', '鼠尾草'], '鼠尾草'], [['燕麦', '奶白'], '燕麦白'],
    [['陶土', '橘', '橙'], '浅陶土'], [['青', '蓝'], '雾青'],
  ]);
  if (paint && /墙|刷|色/.test(input)) { patch.paint = paint; notes.push(`墙面试刷${paint}`); }

  // 5) 地毯
  const rug = firstMatch(input, [
    [['沙发前'], '沙发前'], [['茶几下'], '茶几下'], [['靠窗'], '靠窗'], [['不要地毯', '去掉地毯', '无地毯'], '无地毯'],
  ]);
  if (rug) { patch.rug = rug; notes.push(rug === '无地毯' ? '移除地毯' : `地毯置于${rug}`); }
  else if (input.includes('地毯') && /铺|加|放/.test(input)) { patch.rug = '沙发前'; notes.push('地毯置于沙发前'); }

  // 6) 灯光
  if (/落地灯|加盏灯|加个灯|开灯|暖光/.test(input)) { patch.lamp = true; notes.push('开启暖光落地灯'); }
  if (/关灯|去掉灯|不要灯/.test(input)) { patch.lamp = false; notes.push('关闭落地灯'); }

  // 7) 沙发位置（尊重锁定项；「保留沙发位置」不应触发移动）
  const keepSofa = /保留沙发|沙发不动|锁定沙发|不要动沙发/.test(input);
  if (/锁定/.test(input)) { patch.locked = true; notes.push('锁定沙发规格和摆位'); }
  if (/解锁/.test(input)) { patch.locked = false; notes.push('解除沙发锁定'); }
  if (!scene.locked && !keepSofa && /沙发|挪|移动|靠|摆/.test(input)) {
    const width = scene.width || 4.8;
    if (/左边|靠左|往左|向左/.test(input)) { patch.sofaX = -width * .28; notes.push('沙发移到左侧'); }
    else if (/右边|靠右|往右|向右/.test(input)) { patch.sofaX = width * .28; notes.push('沙发移到右侧'); }
    else if (/中间|居中/.test(input)) { patch.sofaX = 0; notes.push('沙发居中'); }
    if (/转|旋转|朝向/.test(input)) { patch.sofaAngle = (scene.sofaAngle || 0) + 90; notes.push('沙发旋转 90°'); }
  }
  if (keepSofa) notes.push('保留沙发原位置');

  // 8) 一句都没听懂时给出明确反馈，而不是静默无操作
  if (!Object.keys(patch).length) {
    return { patch: {}, summary: '暂时没识别出可应用的改动。可以试试「做双眼皮吊顶，沙发前铺地毯」或「换成奶油风」。' };
  }
  return { patch, summary: '已理解：' + notes.join('、') + '。' };
}

/**
 * 首屏用的等轴测小房间插画（纯 SVG，零图片依赖）。
 * 用清新粉绿的软装配色呼应整体主题，也可作为单文件演示版的品牌视觉。
 */
export const heroRoomSvg = `
<svg viewBox="0 0 500 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wallL" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fdf6ec"/><stop offset="1" stop-color="#f3e9db"/></linearGradient>
    <linearGradient id="wallR" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6ede2"/><stop offset="1" stop-color="#e9ded0"/></linearGradient>
    <linearGradient id="floorG" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4e3c8"/><stop offset="1" stop-color="#e8cfae"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#dff1f0"/><stop offset="1" stop-color="#b9dedc"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect width="500" height="400" fill="#f7faf5"/>
  <circle cx="120" cy="80" r="72" fill="#fbe4ed" opacity=".65"/>
  <circle cx="410" cy="90" r="86" fill="#dff1e4" opacity=".7"/>
  <ellipse cx="250" cy="358" rx="176" ry="30" fill="#b9d6c2" opacity=".35" filter="url(#soft)"/>
  <!-- 地板 -->
  <path d="M250 178 442 272 250 366 58 272Z" fill="url(#floorG)"/>
  <g stroke="#e0c7a4" stroke-width="1" opacity=".7">
    <path d="M154 225 346 319M202 202 394 296M106 249 298 343M298 343 394 200M202 202 106 296M250 178v188"/>
  </g>
  <!-- 左墙 / 右墙 -->
  <path d="M58 272 250 178V78L58 172Z" fill="url(#wallL)"/>
  <path d="M250 178 442 272V172L250 78Z" fill="url(#wallR)"/>
  <path d="M58 172 250 78 442 172" fill="none" stroke="#e6d7c3" stroke-width="2"/>
  <!-- 右墙的窗 -->
  <path d="M300 176 392 220v72l-92-44Z" fill="url(#glass)" opacity=".95"/>
  <path d="M346 198v96M300 198l92 44" stroke="#f7fbf9" stroke-width="4"/>
  <path d="M300 176 392 220v72l-92-44Z" fill="none" stroke="#ffffff" stroke-width="5"/>
  <!-- 左墙挂画 -->
  <path d="M108 194 186 157v46l-78 37Z" fill="#ffffff" stroke="#e6d7c3" stroke-width="2"/>
  <path d="M124 198 170 176v28l-46 22Z" fill="#f6c8d8"/>
  <circle cx="147" cy="196" r="9" fill="#a8d5ba"/>
  <!-- 地毯 -->
  <path d="M250 258 348 306 250 354 152 306Z" fill="#fbe4ec" opacity=".9"/>
  <path d="M250 272 326 308 250 344 174 308Z" fill="none" stroke="#f6c8d8" stroke-width="3"/>
  <!-- 沙发（放在左前） -->
  <g>
    <path d="M108 250 196 206l54 26-88 44Z" fill="#a8d5ba"/>
    <path d="M108 250v30l54 26v-30Z" fill="#8fc3a3"/>
    <path d="M162 276 250 232v30l-88 44Z" fill="#9eccac"/>
    <path d="M116 244 190 209l44 21-74 36Z" fill="#bfe0c8"/>
    <path d="M120 216 186 184l40 19-66 32Z" fill="#a8d5ba"/>
    <path d="M120 216v28l40 19v-28Z" fill="#8fc3a3"/>
    <path d="M160 235 226 203v28l-66 32Z" fill="#9eccac"/>
    <path d="M132 214l22-10 14 7-22 11Z" fill="#f7c8d8"/>
    <path d="M174 216l20-10 12 6-20 10Z" fill="#f6c89a"/>
  </g>
  <!-- 茶几 -->
  <path d="M252 276 306 250l30 14-54 26Z" fill="#d9b489"/>
  <path d="M252 276v10l30 14v-10Z" fill="#c39d74"/>
  <path d="M282 290 336 264v10l-54 26Z" fill="#cdab84"/>
  <!-- 绿植 -->
  <g>
    <path d="M392 258 410 249l10 5-18 9Z" fill="#d8bfa0"/>
    <path d="M394 263v18l16-8v-18Z" fill="#c9ad8d"/>
    <ellipse cx="402" cy="238" rx="18" ry="13" fill="#8fc3a3"/>
    <ellipse cx="392" cy="230" rx="12" ry="10" fill="#a8d5ba"/>
    <ellipse cx="412" cy="230" rx="12" ry="10" fill="#78b591"/>
    <ellipse cx="402" cy="222" rx="11" ry="12" fill="#bfe0c8"/>
  </g>
  <!-- 落地灯 -->
  <path d="M86 236v52" stroke="#9b8a73" stroke-width="3"/>
  <path d="M74 288h24" stroke="#9b8a73" stroke-width="4"/>
  <path d="M74 196 98 208v18L74 214Z" fill="#f8e2b8"/>
  <circle cx="86" cy="196" r="26" fill="#ffe9bd" opacity=".28" filter="url(#soft)"/>
</svg>`;

/** 带院户型的简化底图：按房间矩形生成，供「调整布局」分支展示 */
export function buildCourtyardBackdrop(rooms) {
  const rects = rooms.map(r => {
    const isCourt = r.kind === 'court';
    const fill = isCourt ? '#e9f5ea' : ['#fbf1dc', '#f3f6f1', '#fdeef3', '#eef7f6'][r.name.length % 4];
    return `<rect x="${r.x * 1000}" y="${r.y * 1000}" width="${r.w * 1000}" height="${r.h * 1000}" fill="${fill}" stroke="#9fb8a7" stroke-width="7"/>`;
  }).join('');
  return `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="1000" fill="#ffffff"/>
    <g stroke="#dfe9e1" stroke-width="1"><path d="M0 100h1000M0 200h1000M0 300h1000M0 400h1000M0 500h1000M0 600h1000M0 700h1000M0 800h1000M0 900h1000M100 0v1000M200 0v1000M300 0v1000M400 0v1000M500 0v1000M600 0v1000M700 0v1000M800 0v1000M900 0v1000"/></g>
    ${rects}
    <g fill="#9fb8a7" font-size="16" font-family="system-ui, sans-serif">
      <text x="70" y="40">前院 / 入户方向</text><text x="70" y="978">后院 / 待现场核实门位</text>
    </g>
  </svg>`;
}

/** 功能分区的本地降级结果 */
export function localZones(roomName = '') {
  return /厨|卫|书房|卧/.test(roomName)
    ? { axis: 'y', split: .55, labels: ['收纳区', '活动区'] }
    : { axis: 'x', split: .62, labels: ['会客区', '阅读区'] };
}

/** 户型识别的本地降级结果：直接返回内置示例户型 */
export function localPlan() {
  return { rooms: samplePlan.rooms.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })) };
}
