import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metricBox } from '../src/surfaceGeometry.js';

test('房间地面、墙面 UV 保持米制尺度，不随尺寸拉伸至一张贴图', () => {
  const geometry = metricBox([5.76, 2.75, 4.58]);
  const { normal, uv } = geometry.attributes;
  for (const [axis, expected] of [['y', [5.76, 4.58]], ['x', [4.58, 2.75]], ['z', [5.76, 2.75]]]) {
    const points = [];
    for (let i = 0; i < normal.count; i++) {
      if (normal['get' + axis.toUpperCase()](i) > .5) points.push([uv.getX(i), uv.getY(i)]);
    }
    expected.forEach((span, j) => {
      const values = points.map(p => p[j]);
      assert.ok(Math.abs(Math.max(...values) - Math.min(...values) - span) < .00001);
    });
  }
  geometry.dispose();
});
