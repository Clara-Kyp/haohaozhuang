import { BoxGeometry } from 'three';

/** BoxGeometry 默认每面 0..1；改为米制 UV，避免大墙/地面把纹理拉伸。 */
export function metricBox(size) {
  const geometry = new BoxGeometry(...size);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (Math.abs(normal.getY(i)) > .5) uv.setXY(i, x, z);
    else if (Math.abs(normal.getX(i)) > .5) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  return geometry;
}
