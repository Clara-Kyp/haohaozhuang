import { assets, furnishingWarning, newItem } from './furnishing';

export function showcaseFurnishing(scene, style) {
  const items = [];
  const preferred = scene.roomType === 'living'
    ? [['sofa', -.34, 0, 90], ['coffee', -.03, 0, 0], ['armchair', .24, -.20, -35], ['rug', 0, 0, 0], ['plant', .37, -.37, 0]]
    : Object.values(assets)
      .filter(asset => asset.rooms.includes(scene.roomType) && ['floor', 'rug'].includes(asset.placement))
      .slice(0, 4).map(asset => [asset.id, 0, 0, 0]);
  for (const [assetId, x, z, rotation] of preferred) {
    const asset = assets[assetId];
    let item = {
      id: 'showcase-' + assetId, assetId, name: asset.name, ...asset.dimensions,
      x: x * scene.width, z: z * scene.depth, rotation, elevation: asset.placement === 'rug' ? .008 : 0,
    };
    if (furnishingWarning([...items, item], scene)) item = newItem(assetId, { ...scene, items });
    if (item) items.push({ ...item, reason: '内置素材，可在 3D 空间中调整尺寸与位置。' });
  }
  return {
    style, items, generationId: crypto.randomUUID(),
    summary: '浏览器根据房间尺寸摆放的陈设示例。',
    circulation: '请用俯视视角核对家具之间的通行空间。',
  };
}
