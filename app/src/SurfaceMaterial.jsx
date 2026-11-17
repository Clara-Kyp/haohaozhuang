import { publicAsset } from './deployment';
import React, { useMemo, useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

const files = ['oak_veneer_01_diff_1k.jpg', 'oak_veneer_01_nor_gl_1k.jpg',
  'oak_veneer_01_rough_1k.jpg', 'plastered_wall_03_nor_gl_1k.jpg',
  'fabric_pattern_07_nor_gl_1k.jpg', 'mineral.jpg', 'weave.jpg', 'tile.jpg', 'oak-floor.jpg', 'rug-pile.jpg'];

/** 本地贴图：颜色按 sRGB 解码，法线/粗糙度保持线性数据。每个实例独立 UV 变换。 */
export default function SurfaceMaterial({ name = '', color = '#ffffff', tileCm = 80, size = [1, 1], roughness }) {
  const source = useLoader(THREE.TextureLoader, files.map(file => publicAsset('/textures/' + file)));
  const kind = name.includes('木') || name.includes('地板') ? 'wood'
    : name.includes('砖') ? 'tile' : name.includes('毯') ? 'rug' : name.includes('布') ? 'fabric'
      : name.includes('皮') ? 'leather' : name.includes('石') ? 'stone' : 'plaster';
  const maps = useMemo(() => {
    const copies = [];
    function map(index, repeat = [1, 1], colorMap = false) {
      const texture = source[index].clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(...repeat);
      texture.colorSpace = colorMap ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      copies.push(texture);
      return texture;
    }
    let props;
    if (kind === 'wood') {
      props = { map: map(name.includes('地板') ? 8 : 0, size, true), normalMap: map(1, size), roughnessMap: map(2, size),
        normalScale: new THREE.Vector2(.12, .12), roughness: .8, clearcoat: .12 };
    } else if (kind === 'tile') {
      const repeat = size.map(n => n / (tileCm / 100));
      props = { map: map(7, repeat, true), bumpMap: map(7, repeat), bumpScale: .008,
        roughness: name.includes('亮面') ? .22 : .72, clearcoat: name.includes('亮面') ? .3 : .03 };
    } else if (kind === 'rug') {
      // The weave adds broader variation. The denser normals catch grazing light.
      props = {
        map: map(9, size.map(meters => meters * 2.5), true),
        normalMap: map(4, size.map(meters => meters * 7)),
        normalScale: new THREE.Vector2(.55, .55),
        roughness: .97, specularIntensity: .25,
        sheen: .45, sheenColor: new THREE.Color(color), sheenRoughness: .85,
      };
    } else if (kind === 'fabric' || kind === 'leather') {
      const repeat = size.map(n => n * 4);
      props = { map: kind === 'fabric' ? map(6, repeat, true) : null,
        normalMap: map(4, repeat), normalScale: new THREE.Vector2(kind === 'fabric' ? .2 : .045, kind === 'fabric' ? .2 : .045),
        roughness: kind === 'fabric' ? .93 : .5, sheen: kind === 'fabric' ? .65 : 0,
        sheenColor: new THREE.Color(color), sheenRoughness: .8, clearcoat: kind === 'leather' ? .12 : 0 };
    } else {
      props = { normalMap: map(3, size), normalScale: new THREE.Vector2(kind === 'stone' ? .35 : .055, kind === 'stone' ? .35 : .055),
        bumpMap: /石|水泥|艺术/.test(name) ? map(5, size) : null,
        bumpScale: kind === 'stone' ? .025 : .005, roughness: .92 };
    }
    return { props, copies };
  }, [source, kind, name, color, tileCm, size[0], size[1]]);
  useEffect(() => () => maps.copies.forEach(texture => texture.dispose()), [maps]);
  return <meshPhysicalMaterial color={color} {...maps.props} {...(roughness == null ? {} : { roughness })} />;
}
